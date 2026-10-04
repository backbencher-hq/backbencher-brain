/**
 * XML's entry for `script/m14/ontology-coverage-gate.ts`'s ruling table.
 *
 * ## WHY THE TABLE LIVES HERE AND NOT IN THE GATE
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned shared machinery (lane
 * brief §8), so the TABLE lives in a file this lane owns, in the gate's own `Ruled`
 * shape, and registration is the two-line change the supervisor applies:
 *
 *   import { XML_RULED } from "./xml-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { …, xml: XML_RULED }
 *
 * **AND IT IS ALREADY REGISTERED — gate lines 49 and 196, as of commit 45da9ace0.** The
 * refusal this header used to quote as the reason for the file's existence is HISTORY,
 * kept here because the shape of it is the reason this file exists at all:
 *
 *   $ npx tsx script/m14/ontology-coverage-gate.ts xml        # BEFORE registration
 *   ontology coverage gate — xml
 *   corpus: 11456 admitted files
 *
 *   ontology coverage gate — no RULING TABLE for xml.
 *   Refusing to report: a gate with an empty table would call every un-emitted type
 *   RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *   $ echo $?
 *   2
 *
 * (exit status measured on this branch before registration, corpus 11,456 admitted files
 * across 110 repositories.) That refusal was the gate behaving correctly, and it is also
 * why this lane's RULED verdicts went unadjudicated until the map entry landed — which
 * is the whole point of a table. `validation/m14/fixtures/xml/ruled-gate.ts` therefore no
 * longer proves the table is REACHABLE (the shared file does that, and its runner skips
 * patches 1-2 when it detects xml is already wired); it proves the table is correct, by
 * running the arbiter over the full admitted population and printing the per-probe walk
 * count beside every instrument-B 0.
 *
 * ## WHAT IS AND IS NOT IN THIS TABLE
 *
 * FIVE entries: `uses`, `exports`, `implements`, `instantiates` — every type this
 * analyzer does not emit — plus `extends`, which it DOES emit. The other five emitted
 * types (`contains`, `references`, `imports`, `calls`, `overrides`) are absent, because
 * a table entry for an emitted type is inert WHILE THAT TYPE KEEPS EMITTING: the gate's
 * verdict loop reads `observed` first and `continue`s, never reaching `rulingFor`.
 *
 * ## WHY AN EMITTED TYPE IS IN THIS TABLE
 *
 * That `continue` is the catch. The loop only consults a ruling once `observed.n === 0`,
 * so a table entry for an emitted type is consulted on exactly one corpus shape — the
 * one where the type stopped being emitted — and inert everywhere else. `extends` is
 * the entry that matters, and it is here because of a MEASURED false verdict, not a
 * hypothetical one. Running the arbiter with the corpus root pointed at a single
 * repository (`BB_CORPUS_ROOT`, libxslt only, 1,143 admitted files) drops `extends` to 0
 * emitted edges, and the gate then printed:
 *
 *   extends  RULED-SOUND  NOT EMITTED; the construct occurs 0x on the parse tree.
 *                       Written ruling: …/script/m14/spec/xml-completeness.json#XML-ONTOLOGY-IMPLEMENTS
 *
 * `XML-ONTOLOGY-IMPLEMENTS` is the decision about `implements`. The gate's spec fallback
 * (`rulingFor`) selects a ruling by testing whether the decision's prose MENTIONS the
 * type — ``new RegExp(`\\b${t}\\b`)`` over `dec.resolution` — and that resolution
 * describes "an implements/extends clause", so the word `extends` appears in it. A 0
 * was therefore graded RULED-SOUND on a decision written about a different type, and the
 * `src` it cites names that other decision, so the citation cannot be checked.
 *
 * The gate's mechanism is supervisor-owned (§8) and is REPORTED, not patched. What this
 * file does is make the lane immune to it: `rulingFor` checks `RULED.find(r => r.type
 * === t)` FIRST, and that is an exact-type match, so an `extends` entry here is found
 * before the prose fallback can misattribute anything. The entry also makes the 0
 * decidable rather than merely differently-attributed — its `countOnTree` counts real
 * XSD derivation sites, so "the corpus has no XSD" and "the analyzer missed XSD" come
 * out as different verdicts instead of the same one.
 *
 * `overrides` WAS the fifth entry and was DELETED because the gate falsified it. Run
 * against this table the arbiter reported, over the full 11,456-file admitted
 * population:
 *
 *   overrides  FALSIFIED  NOT EMITTED, but the construct occurs 3x across 3 file(s) on
 *                         the PARSE TREE — it is derivable, so the ruling is wrong.
 *                         e.g. libxslt/tests/docbook/fo/toc.xsl: 2 xsl:template
 *                         competing at match|*|toc.for.section| (lines 180,190)
 *
 * `libxslt/tests/docbook/fo/toc.xsl` declares `<xsl:template match="*" mode=
 * "toc.for.section">` at line 180 and again at line 190, and XSLT 1.0 §5.5 resolves
 * that by running the LATER one. The ruling was wrong and the corpus said so; the type
 * is now EMITTED (`xslt_competing_template_rule`), and its absence here is the correct
 * state for an emitted type. The instrument that found it, and the wrong first version
 * of it, are kept: `validation/m14/fixtures/xml/overrides-probe.mts`.
 *
 * The measurements behind every entry are NOT here. They are in
 * `validation/m14/fixtures/xml/ontology-census.mts` (per-type edges, endpoint
 * resolution, integrity, instrument A's grammar inventory) and, for `overrides`, in
 * `validation/m14/fixtures/xml/overrides-probe.mts`. Each `describe` names the probe
 * that produced its number.
 *
 * ## THE TWO INSTRUMENTS, AND WHY THREE ENTRIES ARE A AND TWO ARE B
 *
 * A. GRAMMAR INVENTORY — for a type needing a node type the language does not have.
 *    `exports`, `implements` and `instantiates` are here. XML's vocabulary is a fixed
 *    set of published specifications (XML 1.0, XSD 1.0/1.1, XSLT 1.0/2.0, RelaxNG,
 *    DocBook, SVG, …) and a declaration in one of them has its own node type only if
 *    the GRAMMAR gives it one. The wired grammar produced **86 distinct node types over
 *    2,787,237 nodes** in the 2,500-file draw, and none of the candidates named below
 *    is among them.
 *
 * B. PARSE-TREE COUNT — for a type the language CAN express, where a grammar inventory
 *    is silent by construction. `uses` and `extends` are here. `uses` for the reason
 *    given above: the construct is expressible, so only a count on the tree can decide
 *    it, where a string or a comment cannot fake it. `overrides` was the second B entry,
 *    its count is what overturned its own ruling, and it is now EMITTED; `extends` is
 *    the third, added for the misattribution above.
 *
 * ## WHERE INSTRUMENT A IS UNSOUND, AND WHAT CARRIES THE COUNTER-EXAMPLE
 *
 * The json lane removed its `exports` ruling because "a grammar cannot see a
 * CONVENTION", and that is right for a Node manifest, where `exports` and `main` are
 * ordinary object keys. XML has the same exposure and it is NOT hypothetical, so the
 * string-shaped populations are measured and carried in the `describe` of each entry
 * rather than left out:
 *
 *   - `exports`: **611 elements whose local name contains "export"** across 3 files.
 *     610 are `<exports>` in `libxslt/doc/libxslt-api.xml`,
 *     `libxslt/doc/EXSLT/libexslt-api.xml` and `ghostty/DoxygenLayout.xml` — gtk-doc /
 *     Doxygen XML that DESCRIBES the exported API of a C library, i.e. documentation
 *     payload; 1 is `<exportedmodules>` in a Doxygen configuration file. Not one is a
 *     declaration in an XML vocabulary, and the count is quoted here precisely so a
 *     reader can see the population that was adjudicated rather than infer that none
 *     was found.
 *   - `implements`: **5 elements** across 4 files — 2 `<interface>` in
 *     `ghostty/src/apprt/gtk/winproto/wayland/protocols/vicinae-hotkey-v1.xml`, which
 *     DECLARE a Wayland protocol interface rather than implement one, and 3 `<abstract>`
 *     in DocBook (`libxslt/doc/tutorial/libxslttutorial.xml`,
 *     `otp/lib/xmerl/doc/examples/xml/xmerl.xml`, `…/xmerl_xs.xml`), which are PROSE
 *     about an abstract class in a C++ manual. All five are `element` nodes in no
 *     vocabulary namespace.
 *   - `instantiates`: **0 elements** named new / instantiate / newinstance / create, and
 *     no node type in the 86 is a construction expression.
 *
 * `uses` is the entry where instrument A would have been unsound and instrument B is
 * the honest choice: XSD writes a constraint keyword on an attribute declaration
 * (`<xs:attribute use="required">`), so the WORD "use" occurs in the language as an
 * ordinary attribute value. That is a constraint, not an adoption of a named
 * definition, and this lane did not measure its corpus frequency — recorded as a
 * limitation rather than asserted either way.
 */

/** The gate's own `Ruled` shape, restated so this file typechecks standalone. */
type Instrument = "A:grammar-inventory" | "B:parse-tree-count"
export type Ruled = {
  type: string
  instrument: Instrument
  nodeTypesThatWouldMeanIt?: string[]
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

const XSLT_NS = "http://www.w3.org/1999/XSL/Transform"
const XSD_NS = "http://www.w3.org/2001/XMLSchema"

/** Shared tree helpers. ZERO REGEX: quotes are stripped by a character test. */
const directChild = (n: any, type: string): any => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}
const unquote = (text: string): string => {
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === "\"" || first === "'") && first === last) return text.slice(1, -1)
  }
  return text
}

/**
 * The `element` node's own tag name and attributes, with namespace bindings applied.
 *
 * Binding resolution is not optional here: `ghostty`'s Wayland files carry an
 * `<interface>` element and an XSLT stylesheet carries `<xsl:template>`, and a probe
 * that matched on local name alone would count a DocBook `<interface>` and an XSLT
 * `<template>` as vocabulary declarations. Both are generic `element` nodes; only the
 * namespace says which language they are written in.
 */
const elementFacts = (n: any, ns: Map<string, string>): { local: string; prefix: string; attrs: Map<string, string>; ns: string | undefined } | null => {
  if (n.type !== "element") return null
  const tag = directChild(n, "STag") ?? directChild(n, "EmptyElemTag")
  if (!tag) return null
  const inner = new Map(ns)
  const attrs = new Map<string, string>()
  for (let i = 0; i < tag.namedChildCount; i++) {
    const a = tag.namedChild(i)
    if (a?.type !== "Attribute") continue
    const an = directChild(a, "Name")?.text.trim()
    const avRaw = directChild(a, "AttValue")?.text.trim()
    const av = avRaw === undefined ? undefined : unquote(avRaw)
    if (an === "xmlns") inner.set("", av ?? "")
    else if (an?.startsWith("xmlns:")) inner.set(an.slice(6), av ?? "")
    else if (an) attrs.set(an, av ?? "")
  }
  const tagName = directChild(tag, "Name")?.text.trim() ?? ""
  const colon = tagName.indexOf(":")
  const prefix = colon >= 0 ? tagName.slice(0, colon) : ""
  const local = colon >= 0 ? tagName.slice(colon + 1) : tagName
  return { local, prefix, attrs, ns: inner.get(prefix) ?? (prefix === "" ? inner.get("") : undefined) }
}

/**
 * Walk every `element` node in the tree, handing `visit` the element's own tag name,
 * attributes and resolved namespace with xmlns bindings applied.
 *
 * ONE implementation, because the first version of this file carried the same
 * namespace-resolution walk twice (once per probe) and a third copy is how the two
 * copies drift. The bindings are read off the element's OWN tag, merged into the
 * inherited map, and the map is threaded down — `xmlns` on an ancestor is what makes
 * a DocBook `<interface>` and an XSLT `<template>` distinguishable, and both are the
 * same `element` node type to this grammar.
 */
const forEachElement = (root: any, visit: (f: NonNullable<ReturnType<typeof elementFacts>>) => void): void => {
  const recurse = (n: any, ns: Map<string, string>): void => {
    const facts = elementFacts(n, ns)
    if (!facts) {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) recurse(c, ns)
      }
      return
    }
    const inner = new Map(ns)
    const tag = directChild(n, "STag") ?? directChild(n, "EmptyElemTag")
    if (tag) {
      for (let i = 0; i < tag.namedChildCount; i++) {
        const a = tag.namedChild(i)
        if (a?.type !== "Attribute") continue
        const an = directChild(a, "Name")?.text.trim()
        const avRaw = directChild(a, "AttValue")?.text.trim()
        const av = avRaw === undefined ? "" : unquote(avRaw)
        if (an === "xmlns") inner.set("", av)
        else if (an?.startsWith("xmlns:")) inner.set(an.slice(6), av)
      }
    }
    visit({ local: facts.local, attrs: facts.attrs, ns: inner.get(facts.prefix ?? "") })
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) recurse(c, inner)
    }
  }
  recurse(root, new Map())
}

/**
 * XSD / XSLT element NAMES that would mean `uses`, as a probe the gate can run.
 *
 * `xsl:use-attribute-sets` and `xsl:use-package` (XSLT 2.0 §10.6, §12.1) are the two
 * constructs in any W3C XML vocabulary that adopt a named, reusable definition rather
 * than naming a declaration. `xsl:key`/`xsl:import` are NOT `uses` — an import is
 * already an `imports` edge carrying a file path, and reading one construct as two
 * labels is the mistake this table exists to prevent.
 */
const USES_ELEMENTS_THAT_WOULD_MEAN_IT = ["use-attribute-sets", "use-package"]

export const XML_RULED: Ruled[] = [
  {
    type: "uses",
    instrument: "B:parse-tree-count",
    describe:
      "an element that ADOPTS a named reusable definition it does not declare — XSLT 2.0's `xsl:use-attribute-sets` (§10.6) or `xsl:use-package` (§12.1), the only two in any W3C XML vocabulary that do this. Probe: every element in the XSLT namespace whose local name is one of those two, counted on the parse tree with namespace resolution applied. MEASURED 0 occurrences across the 2,500-file family-stratified draw (86 distinct node types, 2,787,237 nodes, 110 repositories), so the ruling is not falsified by that draw. Instrument B and not A because the string-shaped population here is real and A cannot see it: XSD writes the WORD `use` as an ordinary attribute value (`<xs:attribute use=\"required\">`), and a grammar inventory would be silent about that while a reader reasonably expects it to have been considered. That attribute is a CONSTRAINT keyword whose three values (`required`, `optional`, `prohibited`) name no construct in the document, so it is not a use of anything — but this lane did not MEASURE its corpus frequency, and that is recorded as a declared limitation rather than asserted either way. DECLINED as neighbours: `xsl:import` (already an `imports` edge carrying a file path), `xsl:key` (declares a named key that is then used, so the KEY is the declaration and a query is a `references` edge), and `xs:include`/`xs:import` in XSD (same file-path reasoning). OVERTURN: a non-zero count of either element name in the XSLT namespace on the parse tree.",
    countOnTree: (root, fileLabel, hits) => {
      forEachElement(root, (f) => {
        if (f.ns === XSLT_NS && USES_ELEMENTS_THAT_WOULD_MEAN_IT.includes(f.local)) {
          hits.push(`${fileLabel}: <${f.local}> in the XSLT namespace`)
        }
      })
    },
  },
  {
    // `extends` is EMITTED, so this entry is consulted only when `observed` is 0 — which
    // is exactly the case it has to be right about. See the header, "WHY AN EMITTED
    // TYPE IS IN THIS TABLE".
    type: "extends",
    instrument: "B:parse-tree-count",
    describe:
      "XSD type DERIVATION — `<xs:extension base=\"T\">` / `<xs:restriction base=\"T\">` (XSD 1.0 Part 1 §3.4.2), emitted as role `xsd_type_derivation` with the base type as target. THIS TYPE IS EMITTED, so this row is reached only on a corpus where the analyzer produced 0 derivation edges, and the two outcomes mean opposite things. 0 derivation SITES on the tree: the corpus simply contains no XSD derivation — the Ruling is that the CORPUS is empty, not that XML lacks the construct, and the fix is a wider corpus. A derivation SITE present on the tree with 0 emitted edges: the gate reports FALSIFIED and is right, because the analyzer is failing to read a construct the corpus does use. That is the whole reason this entry exists: without it the gate's spec fallback attributes an `extends` verdict to WHATEVER RULED PROSE MENTIONS THE WORD, and on this lane that is `XML-ONTOLOGY-IMPLEMENTS`, whose resolution describes 'an implements/extends clause'. A 0 would then be graded RULED-SOUND on a decision written about a different type. OVERTURN: a non-zero derivation-site count on the parse tree of a corpus where this analyzer emits 0 `extends` edges.",
    countOnTree: (root, fileLabel, hits) => {
      forEachElement(root, (f) => {
        if (f.ns !== XSD_NS) return
        if (f.local !== "extension" && f.local !== "restriction") return
        const base = f.attrs.get("base")
        if (base === undefined || base.length === 0) return
        hits.push(`${fileLabel}: xs:${f.local} base=${base}`)
      })
    },
  },
  {
    type: "exports",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "export_declaration",
      "export_statement",
      "export_list",
      "module_export",
      "export_spec",
      "exported_item",
      "public_declaration",
    ],
    describe:
      "a declaration that names what a document or module PUBLISHES. Instrument A, because an export in any W3C XML vocabulary would be an element in a published specification, and this grammar gives published elements their own node types: it produced 86 distinct node types over 2,787,237 nodes in the 2,500-file draw and NONE of the seven candidates above appears among them. Instrument A is UNSOUND for a construct written as ordinary syntax, and that exposure is real here, so the string-shaped population is measured and carried rather than assumed absent: 611 elements whose local name contains \"export\" across 3 files — 610 `<exports>` in `libxslt/doc/libxslt-api.xml`, `libxslt/doc/EXSLT/libexslt-api.xml` and `ghostty/DoxygenLayout.xml`, which are gtk-doc/Doxygen XML DESCRIBING the exported API of a C library and are documentation payload rather than an XML declaration, plus 1 `<exportedmodules>` in a Doxygen configuration file. The surface that would carry an `exports` edge already exists and is measured: every symbol a document publishes is reachable as a `contains` target, and `contains` resolves at BOTH ends on 100.0% of its 77,721 edges in the same draw. OVERTURN: any of the seven node types above at a non-zero count in the grammar inventory, or — independently, and as a search rather than a list of seven — any node type the grammar produces whose name contains `export` at a non-zero count over the corpus.",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "implements_clause",
      "extends_clause",
      "superclass",
      "interface_declaration",
      "interface_implementation",
    ],
    describe:
      "a clause in which a declaration takes on the OBLIGATIONS of another type — an implements/extends clause, a superclass, an interface list. Instrument A: 86 distinct node types over 2,787,237 nodes in the 2,500-file draw, none of the five candidates above present. The nearest XML construct is XSD type DERIVATION (`<xs:extension base=\"T\">` / `<xs:restriction base=\"T\">`, XSD 1.0 Part 1 §3.4.2), and that is EMITTED as `extends` — 1,033 derivation sites over 95 files in this draw, 354 `extends` edges — because derivation names a base TYPE, which is the relation `extends` carries. What XML has no way to write is an obligation without a base: no element in any W3C XML vocabulary declares that its target satisfies another type's interface. The string-shaped population is measured and carried: 5 elements across 4 files — 2 `<interface>` in `ghostty/src/apprt/gtk/winproto/wayland/protocols/vicinae-hotkey-v1.xml`, which DECLARE a Wayland protocol interface rather than implement one, and 3 `<abstract>` in DocBook (`libxslt/doc/tutorial/libxslttutorial.xml`, `otp/lib/xmerl/doc/examples/xml/xmerl.xml`, `otp/lib/xmerl/doc/examples/xml/xmerl_xs.xml`), which are PROSE about an abstract class in a C++ manual. All five are generic `element` nodes in no vocabulary namespace, which is exactly why instrument A does not fire on them and a local-name probe would have. OVERTURN: any of the five node types above at a non-zero count, or an element in a vocabulary namespace whose defined semantics are interface satisfaction.",
  },
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: [
      "new_expression",
      "object_creation_expression",
      "constructor_invocation",
      "instantiate_expression",
      "class_instantiation",
    ],
    describe:
      "an expression or element that CREATES an instance of a declared construct. Instrument A: 86 distinct node types over 2,787,237 nodes in the 2,500-file draw, none of the five candidates above present, and the inventory contains no construction form of any kind — the 86 are prolog, element, attribute, content, DOCTYPE and its declarations, entity/notation declarations, conditional sections, PI, CDSect/CDATA and the anonymous punctuation tokens. Measured from the other side as well, because instrument A alone would be the json lane's mistake: 0 elements whose local name is new / instantiate / newinstance / create, across the same draw. The nearest XML constructs are an XSD `element` DECLARATION (which declares a type; it does not create a value) and an XSLT `xsl:element` / `xsl:copy-of` instruction (which create an output node from a name attribute, and the name is already a `references` edge) — in both cases the document names something rather than instantiating a declared type, which is the distinction this ruling rests on. OVERTURN: any of the five node types above at a non-zero count, or any node type the grammar produces whose name contains `new` or `instantiat` at a non-zero count over the corpus.",
  },
]
