/**
 * HTML's entry for `script/m14/ontology-coverage-gate.ts`'s ruling table.
 *
 * ## WHY THE TABLE LIVES HERE AND NOT IN THE GATE
 *
 * `script/m14/ontology-coverage-gate.ts` is MASTER-owned shared machinery, and
 * `RULED_BY_LANG` in it is a literal with no extension point. Run against `html`
 * it refuses to report at all:
 *
 *   $ bun script/m14/ontology-coverage-gate.ts html
 *   ontology coverage gate — html
 *   corpus: 1252 admitted files
 *   ontology coverage gate — no RULING SOURCE for html.
 *   Refusing to report: with no ruling anywhere, every un-emitted type would be
 *   called RULED-UNJUSTIFIED, and that is a verdict about the absence of evidence,
 *   not about the lane.
 *   Neither RULED_BY_LANG.html nor script/m14/spec/html-completeness.json supplies one.
 *   $ echo $?
 *   2
 *
 * That refusal is the gate behaving correctly, and it is why html's rulings have
 * never been adjudicated by the arbiter this workstream installed. The gate's own
 * comment says where such a table belongs: "A ruling table encodes that lane's OWN
 * corpus probe — its node types, its counts — so it is written by the lane that
 * measured it, not centrally." Thirteen sibling tables already do this
 * (`bash-ruled.ts`, `toml-ruled.ts`, `css-ruled.ts`, `xml-ruled.ts`,
 * `scss-ruled.ts`, …). So it lives in a file this lane owns, in the gate's own
 * `Ruled` shape, and the supervisor's permanent change is two lines:
 *
 *   import { HTML_RULED } from "./html-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { …, html: HTML_RULED }
 *
 * Until those two lines land, `bun script/m14/ontology-coverage-gate.ts html`
 * still exits 2. This file is inert — nothing imports it — so it cannot change
 * any gate's behaviour before it is registered. That is deliberate: the lane
 * writes the evidence, the supervisor wires the registry.
 *
 * ## WHAT IS IN THIS TABLE, AND WHAT IS NOT
 *
 * Four entries: `extends`, `implements`, `overrides`, `exports`. Those are
 * exactly the types html's production `parseFile` emits ZERO of, measured over
 * 1,652 corpus `.html`/`.htm` documents (1,652 parsed, 0 failed).
 *
 * The other six are absent ON PURPOSE. `calls` (3,147 rows), `uses` (74,919),
 * `contains` (12,174), `references` (78), `instantiates` (47) and `imports`
 * (4,682 rows on the importer channel) all appear in the gate's `observed` map,
 * so the gate checks `observed` before it consults a table, and a table entry for
 * an emitted type is dead configuration — it would never be read.
 *
 * And that number is itself the finding the delegation measurement produced, so
 * it is stated here rather than left for the reader to work out:
 *
 *   type         all       html-own    delegate
 *   calls        3147      0          3147
 *   uses        74919    70105        4814
 *   contains    12174    10811        1363
 *   references     78      0            78
 *   instantiates   47      0            47
 *
 * **FIVE of the six firing types reach the graph with html's own contribution at
 * or near zero, and three of them (`calls`, `references`, `instantiates`) fire
 * ONLY because the inline `<script>`/`<style>` seam hands the block to the
 * JavaScript or CSS analyzer.** Origin was measured by differencing the
 * production path against the same path with the seam switched off, so it reads
 * no metadata field and cannot inherit the `htmlEmbedded` tagging defect.
 *
 * ## THE ORIGIN OF EVERY NUMBER IN THIS FILE
 *
 *   script/m14/html-origin-census.ts        per-type, per-origin counts, the six
 *                                           questions, the grammar inventory, and
 *                                           the construct probes for the four
 *                                           silent types
 *   script/m14/html-custom-element-join.ts the `instantiates` join: every
 *                                           `customElements.define("<name>", …)`
 *                                           in 14,193 js/ts files against every
 *                                           hyphenated tag in 1,652 documents
 *   script/m14/html-ontology-census.ts     HTML_FIX's JOB 1 instrument, kept as
 *                                           the independent second measurement
 *
 * Population is DERIVED by readdir from `$BB_CORPUS` in both, never a
 * hand-written file list, because a hand-written list rots silently and no
 * reviewer diffs it against the directory.
 */

// ---------------------------------------------------------------- the gate's own shape
// Declared locally rather than imported: `ontology-coverage-gate.ts` exports no
// `Ruled`, and importing the gate from a file the gate does not import would be a
// cycle. The thirteen sibling tables each declare it the same way.
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

type Ruled = {
  type: Type
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

// ---------------------------------------------------------------- AST helpers
//
// Everything below reads node.type and named children. No regular expression
// appears in this file (programme rule 1): a regex over HTML source matches
// comments, `text` nodes and attribute VALUES, which is exactly how an analyzer
// or a probe lies. The gate's header records two false positives its first
// regex-based version produced — a probe for `extends` matching `class voice`
// inside a telnet IAC word list, and a probe for `instantiates` matching
// `new Map(` inside a bash heredoc — and the fix was the grammar, not a better
// pattern.

function asciiLower(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : text[i]
  }
  return out
}

function elementTagName(node: any): string {
  for (let i = 0; i < node.childCount; i++) {
    const st = node.child(i)
    if (!st || (st.type !== "start_tag" && st.type !== "self_closing_tag")) continue
    for (let j = 0; j < st.childCount; j++) {
      const g = st.child(j)
      if (g && g.type === "tag_name") return asciiLower(g.text)
    }
  }
  return ""
}

/** attribute name -> value, read off grammar nodes so a `text` node, a comment
 *  and an entity can never be mistaken for an attribute. */
function elementAttributes(node: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < node.childCount; i++) {
    const st = node.child(i)
    if (!st || (st.type !== "start_tag" && st.type !== "self_closing_tag")) continue
    for (let j = 0; j < st.childCount; j++) {
      const a = st.child(j)
      if (!a || a.type !== "attribute") continue
      let name = "", value = ""
      for (let k = 0; k < a.childCount; k++) {
        const c = a.child(k)
        if (!c) continue
        if (c.type === "attribute_name") name = asciiLower(c.text)
        else if (c.type === "quoted_attribute_value" || c.type === "attribute_value") {
          let inner: any = null
          for (let m = 0; m < c.namedChildCount; m++) {
            const ic = c.namedChild(m)
            if (ic && ic.type === "attribute_value") { inner = ic; break }
          }
          value = inner ? inner.text : c.text
        }
      }
      if (name.length === 0) continue
      if (out[name] === undefined) out[name] = value
    }
  }
  return out
}

function forEachElement(root: any, visit: (tag: string, attrs: Record<string, string>, node: any) => void): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "element" || n.type === "script_element" || n.type === "style_element") {
      const tag = elementTagName(n)
      if (tag.length > 0) visit(tag, elementAttributes(n), n)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

/**
 * The WAI-ARIA role taxonomy, a specification constant — the same kind of table
 * as the analyzer's own `LINK_FETCHABLE_RELS`. It exists so the `implements`
 * probe can ask a falsifiable question of a `role="…"` value instead of
 * asserting an answer: is this token a member of the closed ARIA enumeration?
 * Abstract roles are included, because an abstract role written on a real
 * element is still an ARIA token and still not a project symbol.
 */
const ARIA_ROLES: readonly string[] = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption",
  "cell", "checkbox", "code", "columnheader", "combobox", "command", "complementary", "composite",
  "contentinfo", "definition", "deletion", "dialog", "directory", "document", "emphasis", "feed",
  "figure", "form", "generic", "grid", "gridcell", "group", "heading", "img", "input", "insertion",
  "landmark", "link", "list", "listbox", "listitem", "log", "main", "marquee", "math", "menu",
  "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "meter", "navigation", "none",
  "note", "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup", "range",
  "region", "roletype", "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox",
  "section", "sectionhead", "select", "separator", "slider", "spinbutton", "status", "strong",
  "structure", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel",
  "term", "textbox", "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
  "widget", "window",
]

// ---------------------------------------------------------------- the table

export const HTML_RULED: Ruled[] = [
  {
    type: "extends",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "class_declaration", "class", "interface_declaration", "trait_declaration",
      "struct_declaration", "inheritance_specifier", "superclass", "base_class_clause",
      "object_declaration", "record_declaration",
    ],
    describe:
      "a base type another type declares itself derived from. INSTRUMENT A, because an " +
      "HTML document has no declaration to attach a base clause to: tree-sitter-html " +
      "produces exactly 20 node types over 1,652 corpus documents (1,652 parsed, 0 failed) — " +
      "tag_name 592313, attribute 325236, attribute_name 325236, quoted_attribute_value 322345, " +
      "attribute_value 321253, element 298771, start_tag 297885, end_tag 290502, text 172629, " +
      "ERROR 25730, entity 10462, self_closing_tag 3922, raw_text 3006, script_element 2929, " +
      "document 1639, comment 1183, doctype 645, erroneous_end_tag 93, erroneous_end_tag_name 93, " +
      "style_element 77 — and not one of them denotes a declaration, a class, an interface, a " +
      "member or a method. " +
      "MEASURED ON THE TREE AS WELL, because a grammar inventory cannot see a spelling: the two " +
      "customized-built-in spellings occur 0 times each in 1,652 documents — `is=\"…\"` " +
      "(<button is=\"fancy-button\">) 0, and Polymer's pre-standard `extends=\"paper-item\"` 0. " +
      "Both were probed separately, because probing only the spelling that happens to occur is " +
      "how a ruling ends up scoped to an accident. Note that even if `is=` occurred, the edge it " +
      "implies is INSTANTIATES (this element is an instance of a custom class that extends the " +
      "built-in), and the EXTENDS edge — custom class to HTMLButtonElement — lives in the " +
      "JavaScript file that calls `customElements.define`, where the JavaScript analyzer already " +
      "emits it. Overturn: any of the node types named above appearing in the inventory, or a " +
      "non-zero count of `is=` / `extends=` on the tree.",
  },
  {
    type: "implements",
    instrument: "B:parse-tree-count",
    countOnTree: (root, fileLabel, hits) => {
      // The falsifiable question, asked of the tree: does any `role="…"` value
      // fall OUTSIDE the WAI-ARIA enumeration?
      //
      // A role inside the enumeration is a specification token. It is not a name
      // this project declares, and four of the nine the corpus actually uses
      // collide with names html's OWN identity ruling already publishes:
      // `button` for `<button id="button">`, `main` for `<main id="main">`,
      // `dialog` for `<dialog id="dialog">`, and `document` for a file called
      // document.html. So an `implements` edge there binds to an arbitrary DOM
      // element — an edge that resolves to something other than what it names,
      // which is the fabrication the ontology workstream exists to prevent.
      //
      // A role OUTSIDE the enumeration would be a project-specific role, i.e. a
      // name the project does declare, and the ruling would be wrong. That is
      // what this probe counts.
      const outside: string[] = []
      forEachElement(root, (_tag, attrs) => {
        const raw = attrs["role"]
        if (raw === undefined) return
        const value = asciiLower(raw.trim())
        if (value.length === 0) return
        if (!ARIA_ROLES.includes(value) && !outside.includes(value)) outside.push(value)
      })
      if (outside.length > 0)
        hits.push(`${fileLabel}: role=${outside.join(",")} — outside the WAI-ARIA enumeration, so a project-declared name`)
    },
    describe:
      "a declaration conforming to an interface the project owns. HTML's only conformance " +
      "construct is the WAI-ARIA `role` attribute, and it names a SPECIFICATION token rather " +
      "than a project symbol. MEASURED: 365 `role=` occurrences in 350 of 1,652 documents, 9 " +
      "distinct values — search 336, button 11, navigation 6, presentation 6, main 2, document 1, " +
      "contentinfo 1, note 1, dialog 1 — and 365 of 365 are members of the WAI-ARIA 1.2 " +
      "enumeration. ZERO fall outside it, which is what this probe counts. The collision is not " +
      "hypothetical: `button`, `main`, `document` and `dialog` are all names html's own identity " +
      "ruling publishes for the `<button id=…>`, `<main id=…>` and `<dialog id=…>` " +
      "elements and for a file called document.html, so the edge would resolve to a DOM " +
      "element and claim an interface " +
      "conformance between a `<form role=\"search\">` and an arbitrary `<div>`. A conformance " +
      "edge whose target is a closed 81-token enumeration the project does not own, and whose " +
      "members collide with the analyzer's own symbol names, is a fabricated edge; it would be " +
      "counted `unexplained` by the differential and would poison bb_graph with a false " +
      "architectural dependency. Overturn: a `role=` value outside the WAI-ARIA enumeration " +
      "naming something the project declares.",
  },
  {
    type: "overrides",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "method_definition", "method_declaration", "function_declaration",
      "member_declaration", "property_declaration", "field_declaration",
      "class_body", "interface_body", "override_specifier", "redefinition",
    ],
    describe:
      "a member replacing an inherited member of the same name. INSTRUMENT A: an override " +
      "needs a member at BOTH ends, and the 20 node types tree-sitter-html produces over 1,652 " +
      "documents (listed in the `extends` entry above, the same inventory) contain no member, no " +
      "field, no method and no class body. HTML has no dispatch, no vtable and no inheritance " +
      "chain, so there is nothing for an override to displace. " +
      "THE ONE CONSTRUCT THAT LOOKS LIKE ONE, MEASURED: `role=\"none\"` / `role=\"presentation\"` " +
      "is the only HTML spelling in which an element discards a semantic it would otherwise " +
      "inherit from the host language — 6 occurrences in 2 of 1,652 documents " +
      "(perl-xml-libxml 5, python-corpus 1). It names an ARIA token, not a declaration, so there " +
      "is still no second endpoint. The second candidate, a duplicate `id`, is measured too and is " +
      "the opposite of an override: HTML resolves it FIRST-WINS (getElementById returns the first " +
      "element registered under the handle), which is why this analyzer allocates a deterministic " +
      "`handle#N` suffix to the later element instead of letting it win — the doc's DUPLICATE-" +
      "IDENTITY ruling, and a disambiguation rather than a replacement. Overturn: any of the node " +
      "types named above appearing in the inventory, or an HTML clause defining last-wins " +
      "redefinition for an element.",
  },
  {
    type: "exports",
    instrument: "B:parse-tree-count",
    countOnTree: (root, fileLabel, hits) => {
      // Two candidates, because "HTML has no module surface" is prose and the
      // gate needs a count.
      //
      //   <slot name="x">  a component's NAMED light-DOM projection point — the
      //                    nearest thing markup has to an exported outlet.
      //   part="x"         a Shadow DOM part: an externally addressable piece of
      //                    this element's surface, reached by CSS `::part()`.
      //                    This is the strongest `exports` candidate HTML has,
      //                    and it was the one most likely to be quietly assumed
      //                    absent, so it is probed rather than argued about.
      const found: string[] = []
      forEachElement(root, (tag, attrs) => {
        const slotName = attrs["name"]
        if (tag === "slot" && slotName !== undefined && slotName.trim().length > 0 && found.length < 4)
          found.push(`<slot name="${slotName.trim()}">`)
        const part = attrs["part"]
        if (part !== undefined && part.trim().length > 0 && found.length < 4) found.push(`part="${part.trim()}"`)
      })
      if (found.length > 0)
        hits.push(`${fileLabel}: ${found.join(" ")} — an externally addressable outlet, i.e. an export`)
    },
    describe:
      "a name this document publishes for a consumer to bind to. An HTML document defines no " +
      "module surface: there is no `export` keyword, no named declaration another file can name, " +
      "and no namespace — a document is a document. That is the reason, and prose alone is not a " +
      "ruling, so the two constructs that could carry the idea are counted on the tree. MEASURED " +
      "over 1,652 corpus documents: `<slot name=\"…\">` 0 occurrences in 0 files, AND `<slot>` in " +
      "ANY form 0 occurrences in 0 files — the ruling's population is the whole slot vocabulary, " +
      "not the narrower named-slot case, because a ruling stated over the narrower population " +
      "would be resting on a subset nobody measured. `part=\"…\"` (Shadow DOM parts, reached by " +
      "CSS `::part()`) 0 occurrences in 0 files. So there is no outlet in the corpus at either " +
      "end of the idea. " +
      "WHAT THIS DOES NOT SAY, because it was the lane doc's defect: exports ROWS DO reach the " +
      "graph, 575 of them in 17 documents, and 0 of them are html's own — every one is the " +
      "inline-JS delegate's, arriving through mergeEmbeddedBlocks. The 2026-10-05 seam fix tags " +
      "them `htmlEmbedded` / `embeddedLang` / `embeddedLineOffset` so a consumer can see that, and " +
      "validation/m14/fixtures/html/embedded-origin-marks pins it. \"markup has no module surface\" " +
      "was TRUE OF HTML and SILENT about where the rows came from. Overturn: a `<slot name>` or a " +
      "`part=` in any corpus document.",
  },
]
