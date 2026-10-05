/**
 * Emit script/m14/spec/xml-completeness.json — the F8 classification the M14
 * ledger names as the AUTHORITATIVE per-language record
 * (`docs/M14-COMPLETENESS-LEDGER.md` § Matrix 4b, "the completeness gate").
 *
 * Every list is DERIVED, not typed: the handled and pass-through vocabularies
 * come from `RealXmlAnalyzer`'s own tables via the shape-safety artifact, and the
 * corpus census comes from the same artifact, so the spec cannot drift from what
 * the analyzer and the corpus actually do. A hand-typed copy of this file would
 * be a claim; this is a reading.
 */
import * as fs from "node:fs"
import * as path from "node:path"
// The lane's four RULED ontology verdicts, read from the table the arbiter consumes
// rather than restated here. One source of truth: a ruling written into this spec and
// a ruling written into `script/m14/xml-ruled.ts` are the same sentence in two places
// only until one of them is edited, and then the spec starts disagreeing with the
// instrument that measures it.
//
// The three fields below are what `script/m14/ontology-coverage-gate.ts`'s `rulingFor()`
// actually reads: `status === "RULED"` and a `resolution` mentioning the type. Without
// them this lane's four RULED verdicts are invisible to the arbiter, which then reports
// every one as RULED-UNJUSTIFIED — a verdict about the spec's field names rather than
// about the rulings. `overrides` is absent from this list because it is EMITTED: an
// entry for an emitted type is dead configuration.
import { XML_RULED } from "./xml-ruled"

const XML_ONTOLOGY_RULINGS = XML_RULED.map((r) => ({
  id: `XML-ONTOLOGY-${r.type.toUpperCase()}`,
  concept: `${r.type} — ontology ruling (${r.instrument})`,
  relationship: r.type,
  status: "RULED",
  instrument: r.instrument,
  node_type: (r.nodeTypesThatWouldMeanIt ?? []).join(" / "),
  ruling: r.describe.split(".")[0] + ".",
  resolution: r.describe,
  measured: `probe and count are in the resolution; instruments in validation/m14/fixtures/xml/ontology-census.mts and validation/m14/fixtures/xml/overrides-probe.mts, executed against the table by validation/m14/fixtures/xml/ruled-gate.ts`,
}))

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..")
const shape = JSON.parse(fs.readFileSync(path.join(ROOT, "validation/m12/results/xml-shape-safety.json"), "utf8"))

const spec = {
  language: "xml",
  grammar: "tree-sitter-xml.wasm",
  grammarPin: {
    upstream: "tree-sitter-grammars/tree-sitter-xml",
    rev: "5000ae8f22d11fbe93939b05c1e37cf21117162d",
    version: "0.7.0",
    patched: true,
    patches: [
      "REPAIR 1 (common/scanner.h, scan_pi_content): the trailing `advance_if_eq(lexer, chr)` became `skip_if_eq`. `advance_if_eq` is defined as `if (!eof && lookahead==chr) advance(); else return false`, so its `else` ABORTED a token whose value the test could not affect — the statements run past `mark_end`, so they are pure lookahead. A processing instruction WITH CONTENT therefore produced no `_pi_content` token at all, the construct could not complete, and the parser wrapped it in an ERROR node; with no XMLDecl the enclosing `prolog` was destroyed too, taking any DOCTYPE in it. Isolated to the byte by a 19-shape battery: the construct parses iff the byte after `?>` is a newline.",
      "REPAIR 2 (xml/grammar.js, _intSubset): `repeat(choice($._markupdecl, $.conditionalSect, $._DeclSep))` over a named `_intSubsetItem`, plus a `conditionalSect` rule. Upstream could not reach a conditional section from an internal subset at ANY version measured — 0.5.0-0.6.x declare `conditionalSect` in the `dtd` grammar and inline it, but `_intSubset` referenced `$._markupdecl`, which does not include it; 0.7.0 does not declare it in the `xml` grammar at all. The failure wrapped the `doctypedecl` in an ERROR, the parser took a LATER `Name` as the DTD's name, and the analyzer published a Type symbol literally called `INCLUDE`.",
    ],
    patchAdmissibility:
      "8,888 corpus files / 6.69M nodes, ERROR and MISSING counted per file: 31 files repaired, 2 moved, 8,855 unchanged, corpus MISSING nodes 32 -> 10. BOTH movements are adjudicated by measurement in fixtures/xml/out/regression-adjudication.json: one is a standalone `.dtd` (root ERROR under every build, so never in the wired surface; upstream's separate `dtd` grammar parses it with 0 ERROR nodes) and the other is libxml2's own fuzzer-regression directory, kept by the project precisely because those files must not parse.",
    wiredSha256: "2425a26e77dce87d7157f89b2e39920c67436a672263827dea3516210f93b1c8",
    vendoredSource: "grammars/tree-sitter-xml",
    gate: "bun script/m14/verify-grammar-pins.ts (lane xml)",
    sourceVsWasm: "all 56 declared names present (5 supertypes hidden by design), 51 wasm-named types all declared, 0 built-in extras — re-measured by the gate on every run",
    pinRecord: "grammars/tree-sitter-xml/PIN.md",
  },
  corpus: {
    _note: "The named types the 8,888-file corpus never produced are listed below with the reason. `ERROR` is tree-sitter's runtime node, absent from node-types.json by design, and is observed on 177 routed files.",
    differentialFiles: 7975,
    differentialNodes: 5899555,
    censusFiles: 8888,
    repos: 6,
    grammarNamedTypes: 51,
    grammarTypesObserved: Object.keys(shape.observed ?? {}).length,
    grammarTypesNotObserved: shape.declaredButUnobserved ?? [],
    runtimeTypesObserved: ["ERROR"],
    errorFiles: 177,
    missingNodes: 9,
    routedFileTypesExercised: ["xml", "xsd", "dtd", "xsl", "xslt", "svg", "rng"],
    routedButDeclaredNegative: "dtd — exercised through 4 declared negative controls, because a standalone `.dtd` is not representable by the xml grammar (see grammarPin.patchAdmissibility and the notApplicable entry below).",
    manifest: "fixtures/xml/repositories/MANIFEST.json",
  },
  handled_verified: {
    _rule: "the analyzer reads this node to produce a symbol, a relationship, an import, or a metadata value; each is pinned by a fixture in validation/m14/fixtures/xml, except where corpus.grammarTypesNotObserved says no corpus example exists",
    types: Object.keys(shape.declared).sort(),
    reasons: shape.declared,
  },
  pass_through_classified: {
    _rule: "walked THROUGH deliberately, each with the reason, so a pass-through is a decision on record and not a shrug",
    types: Object.keys(shape.passthrough).sort(),
    reasons: shape.passthrough,
  },
  internal_silent: {
    _rule: "The gate has exactly FOUR buckets — handled_verified, internal_silent, gap, and a design_decision carrying a node_type — so `internal_silent` is the UNION of 'walked through with no output' and 'walked through to read a child'. A pass-through is a member of it. Derived from the analyzer's own PASSTHROUGH_LITERALS plus the hidden rules, so it cannot drift; the FIRST version of this file listed only the former and the gate reported `Mixed` and `children` as in NO bucket, which is the gate being right and this file being behind.",
    types: [
      // Hidden rules (`_`-prefixed) are deliberately ABSENT: the gate's grammar
      // vocabulary is built by filtering `_`-prefixed names out, so listing one
      // reads as "a classified row the wasm no longer produces". The gate was
      // right and this file was wrong.
      ...Object.keys(shape.passthrough).sort().filter((t: string) => !t.startsWith("_")),
    ],
  },
  gap: {
    _rule: "an observed node type in NO bucket. xml's list is EMPTY by construction and that is the claim worth gating: the analyzer declares a vocabulary, the corpus census is measured against it, and `script/m12/xml-node-types-compare.ts` check B fails on the first unclassified type. The list is emitted from the gate's own result, so it cannot be quietly emptied.",
    gaps: [],
    gapCount: 0,
    evidence: "validation/m12/results/xml-shape-safety.json — check B, `every node type seen in fixtures, probes and the corpus is classified`, green over 49 observed named types",
  },
  design_decision: {
    _rule: "the relationship ontology and the refusals, each RULED on a measurement. A record with no node_type documents a resolved defect or a whole-concept refusal and classifies nothing.",
    decisions: [
      { concept: "contains", relationship: "contains", ruling: "structural containment read off the tree, and every contains TARGET is a published symbol in the same file", measured: "177,890 contains edges over the corpus; the target-resolves invariant is pinned by xml/dtd-declarations", node_type: "" },
      { concept: "references", relationship: "references", ruling: "a NAME, never a written value: the target is the LOCAL NAME and the prefix rides in metadata", measured: "11,117 resolvable QName references; 1,319 values refused because they resolve to nothing in the document", node_type: "" },
      { concept: "imports", relationship: "imports", ruling: "a FILE PATH, the one case where a value is the right target", measured: "630 distinct schemaLocation targets, 238 DOCTYPE external IDs, 78 entity/notation external IDs, 18 stylesheet hrefs — 0 of them emitted before the fix", node_type: "" },
      { concept: "declared name", ruling: "in a declaration vocabulary the DECLARED name is an attribute VALUE and the tag is kept as meta.tagName", measured: "26,578 in-vocabulary declarations: recall 0.045 -> 0.696, with the 29,196 out-of-vocabulary `name` attributes (DATA) left untouched", node_type: "" },
      { concept: "self edge", ruling: "refused for references and imports; ALLOWED for contains, because a DTD and an element it declares routinely share a name and those are two distinct declarations", measured: "3 self-references and 3 phantom symbols removed from a 20-symbol XSD; the contains case is pinned by xml/dtd-declarations and xml/conditional-section", node_type: "" },
      { concept: "PEReference", ruling: "a parameter entity reference IS a use and emits `references`, owned by the DOCTYPE in the internal subset and by the DECLARING ENTITY inside replacement text; the `% name 'value'` VALUE form names nothing and is refused, as is a reference whose semicolon is missing", measured: "0 PEReference nodes across the FULL 11,456-file admitted population — the 22 admitted files whose text carries `<!ENTITY %` are bare .dtd fragments this grammar cannot root, and the one admitted .xml carries its occurrences inside CDATA. The branch is live on fixtures (4 nodes in 2 files, all published) and pinned by xml/xsd-parameter-entity-refs and xml/pereference-semicolon-required; instrument validation/m14/fixtures/xml/pereference-shape-probe.mts", node_type: "PEReference" },
      { concept: "xmlns with an empty prefix", ruling: "declares nothing publishable", measured: "4 corpus occurrences published a symbol named the empty string; 0 now, pinned by the M12 probe", node_type: "Attribute" },
      // The four RULED ontology verdicts, carried in the fields the arbiter reads.
      // `overrides` is NOT here: it was, until the arbiter falsified the ruling over
      // 11,456 corpus files, and it is emitted now.
      ...XML_ONTOLOGY_RULINGS,
    ],
  },
  notApplicable: [
    {
      concept: "RULED types, and the instrument each ruling rests on",
      measured: "Four of the ten ontology types are RULED with a corpus measurement, not with prose, and each names the probe that produced its number and the count that would overturn it. `uses` (instrument B, parse-tree count): 0 occurrences of `xsl:use-attribute-sets` or `xsl:use-package` in the XSLT namespace over a 2,500-file draw. `exports` (instrument A, grammar inventory): none of 7 export-declaration node types among the 86 the wired grammar produces over 2,787,237 nodes, with 611 string-shaped `<exports>`/`<exportedmodules>` elements adjudicated as gtk-doc/Doxygen payload describing a C library's API. `implements` (A): none of 5 supertype-clause node types among the 86, with 5 string-shaped hits adjudicated as 2 Wayland `<interface>` DECLARATIONS and 3 DocBook `<abstract>` prose. `instantiates` (A): none of 5 construction node types among the 86, and 0 elements named new/instantiate/newinstance/create. Overturn conditions are in script/m14/xml-ruled.ts, whose probes are executed by validation/m14/fixtures/xml/ruled-gate.ts.",
    },
    {
      concept: "calls / extends / overrides — NOT applicable, and this entry is the record of that being WRONG",
      measured: "This entry previously claimed all four of `calls`, `extends`, `implements`, `overrides` and `instantiates` inapplicable, on the reasoning that an XSD names a type by an ATTRIBUTE VALUE so `base=` is a `references` edge. The M60 ontology census overturned it by measurement: `calls` is emitted for XSLT `xsl:call-template` (XSLT 1.0 §6, 548 edges), `extends` for XSD `<xs:extension base=>`/`<xs:restriction base=>` type derivation (XSD 1.0 §3.4.2, 438 edges), and `overrides` for XSLT 1.0 §5.5 competing template rules — that last one only after script/m14/ontology-coverage-gate.ts reported this lane's RULED verdict FALSIFIED over 11,456 files (3 sites in 3 files, e.g. libxslt/tests/docbook/fo/toc.xsl lines 180 and 190). The reasoning was not wrong about the SYNTAX: `base=` is an attribute value. It was wrong about the RELATION, because a vocabulary element that defines a relation is a declaration of that relation however its operand is spelled. Kept as a record because a reader comparing this spec against an older one needs to see that the claim changed and why.",
    },
    {
      concept: "standalone .dtd documents",
      measured: "routed (`.dtd` is in EXTENSION_LANGUAGE) but NOT representable: the xml grammar's `document` rule requires a document element, so a standalone DTD's root node type is ERROR. Measured: `cond_sect1.dtd` 11 ERROR nodes, `cond_sect2.dtd` 8, the W3C `XMLSchema.dtd` 170 — while upstream's SEPARATE `dtd` grammar parses all of them with 0. Filed as owed, with its measurement, in grammars/tree-sitter-xml/PIN.md; the corpus files are declared negative controls rather than excluded by a glob.",
    },
  ],
  requiredKinds: ["contains", "references", "imports"],
  // The three emitted ONTOLOGY types, and the two the M60 census added. `calls` and
  // `extends` were named a `references` edge by an earlier version of this spec; the
  // census overturned that and the reasoning is recorded in `notApplicable` above.
  ontologyRelationshipsEmitted: ["contains", "references", "imports", "calls", "extends", "overrides"],
  ontologyRelationshipsRuled: ["uses", "exports", "implements", "instantiates"],
  kindRulings: {
    contains:
      "structural containment read straight off the tree: element->element, element->attribute, element->namespace, DTD->declaration, declaration->content-model member, declaration->notation, PI->target. Every contains TARGET is a published symbol in the same file — enforced structurally, not by convention, and pinned by `xml/dtd-declarations` (`every contains target resolves to a symbol in the same file`).",
    references:
      "a NAME, never a written value. The target of an XSD/RelaxNG/XSLT reference is the LOCAL NAME and the prefix rides in metadata, because a prefix in a target is a value where a name belongs (M60.R10). An edge is emitted only when the target resolves in the document or is a specification built-in — 1,319 unresolved values are REFUSED rather than published.",
    imports:
      "a FILE PATH, which is the one case where a value IS the right target: a DOCTYPE's ExternalID, a DTD entity's or notation's ExternalID, a StyleSheetPI/XmlModelPI `href`, and an XSD `schemaLocation` URI. 630 distinct schemaLocation targets and 11 external-ID imports were emitted where the pre-fix lane emitted 0.",
  },
  payloads: {
    line: {
      key: "line_number",
      note: "every relationship carries a line, and 100% of them are on the line the TARGET NAME is written on (M59.A7 / #825). Pre-fix: the external-ID edge took the ExternalID node's line, so a multi-line PUBLIC doctype pointed at the keyword — 310 wrong-line edges, now 18. Pinned by all 8 fixtures, and by the multi-line doctype in `xml/dtd-declarations`, which is the shape that makes the keyword-line mutant non-vacuous.",
    },
    occurrences: {
      key: "meta.occurrences",
      note: "edge collapse is COUNTED, not hidden. Edge identity is `source|type|target`, so N declarations of one pair necessarily share one edge — 492,774 occurrences on 45,297 edges. The edge keeps the EARLIEST line the name is written on, not the first the LIFO walk reached. Pinned by `xml/edge-collapse`.",
    },
    syntaxErrors: {
      key: "meta.syntaxErrors",
      note: "a symbol or edge from a file the analyzer reports as erroneous says so. Pre-fix: 27,228 symbols over 177 files, unlabelled, and the shipped 'creates no recovery symbols' check was a FIXTURE ACCIDENT. Suppressing them would be wrong (177 of 177 are `##` Maven-archetype templates), so they are labelled. Pinned by `xml/recovery-labelling`, including the negative half — a clean file carries no label, so the flag cannot become noise.",
    },
    declaredName: {
      key: "meta.declaredName",
      note: "in a declaration vocabulary the DECLARED name is an attribute VALUE, and the tag name is kept as `meta.tagName` so the structural reading is carried rather than overwritten. Gated on the element's EFFECTIVE NAMESPACE: 29,196 `name` attributes outside any declaration vocabulary are DATA and must not be renamed, which is why the rule is not tag-gated. Recall 0.045 -> 0.696 over 26,578 in-vocabulary declarations.",
    },
    resolvable: {
      key: "meta.resolvable",
      note: "a `references` edge records whether its target resolves `in-document` or is a specification `builtin`, so a consumer can tell a resolved edge from a built-in one without re-deriving the namespace bindings.",
    },
  },
  routing: {
    grammarDeclares: ["xml", "svg", "xsd", "xslt", "xsl", "rng"],
    routerWires: ["xml", "xsd", "dtd", "svg", "xsl", "xslt", "rng"],
    routedByThisWave: "svg, xsl, xslt, rng — taken from the grammar's own `tree-sitter.json` `file-types`, which the router had been narrower than.",
    unroutedAndWhy:
      "`.wsdl` (805), `.pom` (693), `.xhtml` (36) and extensionless build files (4) are XML-shaped but the grammar does not declare them, so routing them would be a claim the grammar does not back. The M60 #913 ruling is to refuse rather than to claim. 1,538 files, visible debt.",
  },
  gates: {
    contract: "script/m12/xml-contract-probe.ts (90 checks, was 14)",
    completeness: "script/m12/xml-node-types-compare.ts (9 checks + a self-test that catches 9 of 9 mutations; its predecessor scraped the analyzer's source with a regular expression and was satisfied by an EMPTY list)",
    fixtures: "bun script/m14/run-fixtures.ts --lang xml (8, was 1)",
    mutants: "bun script/m14/mutate-analyzer.ts (9, all caught, was 0)",
    corpusErrors: "script/m12/xml-corpus-errors.ts (revision-pinned manifest + declared negative controls)",
    corpusMeasure: "script/m12/xml-corpus-measure.ts (same manifest; the two gates previously disagreed on the same files)",
    referenceAgreement: "fixtures/xml/probes/grammar-verdict-vs-reference.mts (16/16 against Python expat — a conforming implementation this repository does not own)",
    reproducibility: "bash fixtures/xml/run-all.sh [--full]",
  },
  knownGateGaps: [],
  // Sections E and F are CLOSED. They read a `grails-core:xml` floor row out of
  // differential-baseline.json, and `script/m14/differential.ts` had no xml lane.
  // It has one now, and the row is PINNED: missing=0, unexplained=0, heuristic=0,
  // avgMsPerFile 25.5, sampleSetHash ca66a7bb0706a21a. 8/8 sections pass.
  //
  // What it took, in order, and none of it was the analyzer:
  //
  // 1. The oracle's per-node tables were keyed by the NODE OBJECT. web-tree-sitter
  //    builds a fresh wrapper on every `child()` call, so `parent.child(0) ===
  //    parent.child(0)` is false and a Map keyed by object is not a lookup table.
  //    Phase 1 filled it, phase 2 read it with different wrappers, and every
  //    derived edge carried an empty `from`. Keyed by `node.id` — a stable number
  //    — and the lane went from 45.9% unexplained to 0.
  // 2. A dead DTD branch that could never fire: the declaration node types are not
  //    `element` nodes, and the loop was guarded by `if (n.type !== "element")`.
  //    It read as coverage and was not.
  // 3. The DTD USAGE classes the element walk cannot see at all: a content
  //    model's member names, a `NOTATION (a|b)` attribute type, and an `NDATA`
  //    clause. None is a declaration and none is under a `contentspec`.
  // 4. A processing instruction nested in an element — Adobe's `<?xpacket?>` pair
  //    inside `<metadata>`, which is ordinary SVG. A document-level PI correctly
  //    gets no owner, and the oracle has to reproduce that rather than assume it.
  //
  // The pin itself refused twice before it accepted, which is the pin working: it
  // skips any lane carrying its own missing or unexplained, because pinning a real
  // anomaly would bake it into the number a later run is scored against. It said
  // `unexplained=2` and declined. The 2 were the `<?xpacket?>` containment edges.
  differentialLane: {
    lane: "xml registered in differential.ts LANGS / LANG_REPOS / the contains-audited label set",
    corpusRootOverride: "BB_CORPUS_ROOT, because the XML corpus is restored into the xml workdir at its pinned revision and grails-core is not under the shared root any more — java, groovy, kotlin and javascript all map to it and cannot record a floor either",
    ext: "xml,xsd,dtd,xsl,xslt,svg,rng — svg is 155 of grails-core's 314 and wsdl is NOT claimed by the engine (805 files recorded as unrouted under M60 #913)",
    auditedLabelSet: "contains only, and deliberately: the oracle derives containment and the DTD usage classes and nothing else, so auditing imports/references/calls would score every such edge unexplained against truth never derived",
    measured: "4 independent cold-pool draws: 25/60/100/40 files, covered 100%, MISSING=0, unexplained=0 in every one",
  },
  review: "reviews/xml/master-review.md",
  artifacts: "fixtures/xml/out/*.json, fixtures/xml/repositories/MANIFEST.json",
}

fs.mkdirSync(path.join(ROOT, "script/m14/spec"), { recursive: true })
fs.writeFileSync(path.join(ROOT, "script/m14/spec/xml-completeness.json"), JSON.stringify(spec, null, 2) + "\n")
console.log(
  `wrote script/m14/spec/xml-completeness.json — declared ${spec.handled_verified.types.length}, ` +
  `pass-through ${spec.pass_through_classified.types.length}, notApplicable ${spec.notApplicable.length}, ` +
  `notObserved ${JSON.stringify(spec.corpus.grammarTypesNotObserved)}`,
)
