# real-xml-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-xml-analyzer.ts`
- Parser: vendored `wasm/tree-sitter-xml.wasm`
- Grammar vocabulary verified against the production WASM: `document`,
  `element`, `STag`, `EmptyElemTag`, `Name`, `Attribute`, `AttValue`, `PI`,
  `PITarget`, `doctypedecl`, `ExternalID`, `SystemLiteral`, `elementdecl`,
  `AttlistDecl`, `AttDef`, `DefaultDecl`, `StringType`, and `PubidLiteral`.
- Wiring: `ASTEngine.parseFile` → `RealXmlAnalyzer`
- Detection: `.xml`, `.xsd`, and `.dtd` map to the XML analyzer; the parallel
  indexer includes all three extensions. `.xsd` is treated as XML because XML
  Schema is an XML vocabulary, not a separate parser.

The analyzer performs one iterative AST traversal. It never scans source text
for tags, names, attributes, DTD declarations, or processing instructions.
Values are read only from their grammar nodes (`AttValue`, `SystemLiteral`,
`PubidLiteral`) and normalized with bounded string operations.

## Symbol contract

| Construct | Symbol kind | AST extraction |
| --- | --- | --- |
| XML element | `class` | `element` → direct `STag`/`EmptyElemTag` → `Name` |
| XML attribute | `property` | `Attribute` → direct `Name` and `AttValue` |
| namespace declaration | `namespace` | `Attribute` whose `Name` is `xmlns` or starts with `xmlns:` |
| processing instruction | `module` | `PI` → `PITarget` (the XML declaration is skipped) |
| DOCTYPE declaration | `type` | `doctypedecl` → direct `Name` |
| DTD element declaration | `type` | `elementdecl` → direct `Name` |
| DTD attribute declaration | `property` | `AttlistDecl` → `AttDef` → `Name` |
| XML Schema construct | `class` | ordinary `element` symbol, with `isSchemaConstruct` metadata for known XSD vocabulary names |

Every symbol has an exact AST range, visibility, metadata node type, and stable
owner identity where an element is nested. Qualified element names preserve XML
prefixes (`xs:element`, `book:book`); containment uses the nearest AST element
owner. XML has no function parameters, return types, decorators, or exports, so
those fields are intentionally absent rather than synthesized.

Syntax errors are retained by the engine as warning `ParseError` records. The
negative fixture demonstrates that malformed XML is not silently accepted or
turned into phantom recovery symbols.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `contains` | element → nested element; element → attribute/namespace; element → processing instruction when nested; DTD declaration → declaration |
| `imports` | DOCTYPE `ExternalID` system/public literal → external DTD path |
| `uses` | not emitted; XML syntax alone does not establish executable use |
| `calls`, `extends`, `implements`, `instantiates`, `exports`, `overrides`, `references` | not emitted; no such semantics exist in the XML grammar |
| imports array | external DTD `ExternalID` becomes an `ImportInfo` with `importType: xml-doctype` |

Relationships are deduplicated by `(source, type, target)` in a `Set`, so the
same tag/attribute identity cannot create repeated edges during traversal.
Document-level processing instructions intentionally have no synthetic element
owner; they are emitted as symbols without a containment edge.

## Supported constructs

Independent fixtures cover:

- XML declaration, namespaced elements, default and prefixed namespaces,
  attributes, nested elements, empty-element tags, and processing instructions
  (`validation/m12/fixtures/xml/Catalog.xml`);
- external DTD identity and import relationship
  (`validation/m12/fixtures/xml/Doctype.xml`);
- XML Schema structure, XSD namespace, and schema attributes
  (`validation/m12/fixtures/xml/Schema.xsd`);
- malformed closing tags and explicit syntax-error handling
  (`validation/m12/fixtures/xml/Negative.xml`).

A separate shape probe exercises internal DTD declarations, including
`elementdecl`, `AttlistDecl`, `AttDef`, `DefaultDecl`, `StringType`, and
`PubidLiteral`. These node types are live in the grammar even though the clean
production corpus acceptance set contains XML/XSD documents rather than
standalone DTD files.

## Unsupported / explicit-unknown constructs

- Standalone `.dtd` files are detected as XML but are not included in the
  production corpus acceptance set because the wired XML grammar requires a
  document element. External DTD references are supported and tested.
- XML Schema semantics are structural only: the analyzer records XSD elements
  and attributes but does not validate types, restrictions, substitution groups,
  or cross-document schema references.
- Entity expansion and runtime external-resource loading are not performed.
  The AST records declaration nodes and external identifiers without fetching
  files.
- Character data, comments, CDATA payloads, and XML declaration metadata are
  not symbols; they are document content rather than declarations. CDATA and
  comments are retained by the parser and never source-scanned by the analyzer.
- Grammar recovery errors remain explicit. The analyzer does not rewrite
  malformed XML or infer missing tags.

## Regex inventory

The XML analyzer has **zero regex usages**. The previous element-name regex and
source-text attribute parsing were removed. The refreshed machine census reports
39 classified regex usages across all 41 analyzers, with **0 XML entries**, 0
missing entries, 0 stale entries, and 0 unclassified entries.

## Complexity envelope

Evidence: `validation/m12/results/xml-corpus-complexity.json`.

| Run | files | symbols | relationships | wall ms | files/s | symbols/s | relationships/s | errors | crashes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Grails XML/XSD corpus | 154 | 6,195 | 2,388 | 2,188.9 | 70.36 | 2,830.24 | 1,090.98 | 0 | 0 |

The hot path is a single explicit stack traversal. Each AST node is visited
once; direct child lookups scan only the bounded child list of that grammar
node, and emitted relationship dedupe is constant-time. There are no scans of
the complete symbol or relationship list and no O(n²) per-symbol resolution.
Space is O(h + s + r), where `h` is traversal depth and `s`/`r` are emitted
symbols/relationships.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/xml.json`
- Authority: manual audit of independent XML/XSD/DOCTYPE fixtures
- Result: `validation/m12/results/xml-differential.json`
- Differential: **49/49 facts, precision 1.000, recall 1.000, 0 FP, 0 FN,
  0 unknown**
- Contract probe: `validation/m12/results/xml-contract.json`
- Shape safety: `validation/m12/results/xml-shape-safety.json` — 16/16 analyzer
  node references live, with 0 dead defensive references.

## Corpus validation

- Corpus: `grails_core@a83f87480e0c0138caa5a7191a053b1e59a64066`
- Scope: 154 tracked `*.xml`/`*.xsd` files, deterministic lexicographic order
- Result: **0 grammar-error files, 0 grammar-error nodes, 0 crashes**
- Evidence: `xml-corpus-errors.json`, `xml-corpus-complexity.json`, and
  `xml-corpus-shapes.json`
- Standalone tracked `*.dtd` files are an explicit boundary and are not
  falsely counted as XML documents.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/xml/`
- Ground truth: `validation/m12/ground-truth/xml.json`
- Differential: `validation/m12/results/xml-differential.json`
- Contract: `validation/m12/results/xml-contract.json`
- Corpus errors: `validation/m12/results/xml-corpus-errors.json`
- Complexity: `validation/m12/results/xml-corpus-complexity.json`
- Shape safety: `validation/m12/results/xml-shape-safety.json`
- Evidence scripts: `script/m12/xml-corpus-errors.ts`,
  `xml-corpus-measure.ts`, `xml-node-types-compare.ts`, and
  `xml-contract-probe.ts`

## Issue

M12.35 / GitHub issue #174.
