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
owner identity where an element is nested. XML has no function parameters,
return types, decorators, or exports, so those fields are intentionally absent
rather than synthesized.

### Declared names, not written prefixes

Qualified element names **do not** keep their prefix. An element in a namespace
the analyzer knows a declaration vocabulary for is published under the name it
**declares**, and the written `prefix:local` form is kept in metadata:

| written | declared name | namespace |
| --- | --- | --- |
| `xsd:element name="catalog"` | `catalog` | `…/2001/XMLSchema` |
| `xsl:template name="render"` | `render` | `…/1999/XSL/Transform` |
| `book:book` | `book` (a declaration) or the local name (not one) | `…/2001/XMLSchema-instance` is a known-vocabulary namespace; an ordinary `book:` prefix is not, and the local name is used |

This is not a rename for tidiness. The question the index has to answer is
"which component does this name refer to", and in a 2,439-file XSD corpus the
prefix is a property of the *file*, while the declared name is a property of the
*component*. `xs:element` is the same 30 times in `spring-context.xsd` and
`hibernate-mapping.xsd` and refers to a different component in each. Publishing
the prefix collapsed two components onto one identity.

`metadata.writtenName` keeps the source form, `metadata.namespace` the resolved
URI, and `metadata.isVocabDeclaration`/`vocabNamespace` mark the symbols whose
name came from a declaration attribute. Namespaces that are **not** declaration
vocabularies are left alone: `book:book` with an unrecognised prefix keeps
`book:book`, because there is no declaration attribute to read a better name
from and inventing one would be a guess.

Namespaces are resolved ONCE per element and inherited through a scoped stack, so
a prefix bound on the root is visible to every descendant. Resolving per text node
loses root-level bindings for the majority of a real schema.

Syntax errors are retained by the engine as warning `ParseError` records. The
negative fixture demonstrates that malformed XML is not silently accepted or
turned into phantom recovery symbols.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `contains` | element → nested element; element → attribute/namespace; element → processing instruction when nested; DTD declaration → declaration |
| `imports` | DOCTYPE `ExternalID` system/public literal → external DTD path |
| `references` | a QName-valued attribute resolved through a declared prefix → the component it names (`type`, `base`, `ref`, `itemType`, `substitutionGroup`, …). The target is the LOCAL name, published as a symbol on the same document, so the edge is resolvable rather than dangling |
| `calls` | `xsl:call-template` / `xsl:apply-templates` → the `xsl:template` that declares the named template |
| `imports` | `xsl:import`/`xsl:include` `href` → the stylesheet path, alongside the DOCTYPE and `schemaLocation` forms |
| `uses` | not emitted; XML syntax alone does not establish executable use |
| `extends`, `implements`, `instantiates`, `exports`, `overrides` | not emitted; no such semantics exist in the XML grammar |
| imports array | external DTD `ExternalID` becomes an `ImportInfo` with `importType: xml-doctype` |

Every `contains` target is a symbol published by this analyzer — that is a hard
invariant, checked by a gate, because a `contains` edge pointing at a name that
is not a symbol is a graph that cannot be walked.

A `references` target is a local name, a built-in, a name in another file, or a
name this file does not satisfy — and the four are told apart in
`metadata.resolvable` rather than left to the reader. Measured over the corpus
(31,770 reference edges):

| `resolvable` | meaning | edges | share |
| --- | --- | ---: | ---: |
| `in-document` | declared in this file; the target is a symbol this analyzer published | 21,474 | 67.6 % |
| `builtin` | an XML/XSD built-in type | 7,520 | 23.7 % |
| `external` | declared in a file this document imports; the edge records WHICH file in `importedFrom` | 2,363 | 7.4 % |
| `unresolved` | a **real** reference this file does not satisfy — satisfied only by an `xs:include`, which a per-file analyzer cannot see | 413 | 1.3 % |

Only `in-document` publishes a target symbol. The other three deliberately do not:
a phantom local symbol is the M60.R10 lie, and a consumer that resolves a
built-in, an external or an unresolved reference to a symbol with no declaration
behind it is worse off than one that is told where to look.

`builtin` carries the full `qname`, `prefix` and `namespaceUri`, so
`type="xs:string"` is recorded as a reference to the built-in `string` and never as
a local symbol named `string`.

`unresolved` carries `ambiguousWithBuiltin` — 103 of the 413 — when the name is
*also* a built-in. That is the one case where a consumer must not guess either way:
`<!ENTITY>`-style shadowing aside, a bare `type="date"` may mean XSD's built-in
`date` or a same-named type an `xs:include` brought in, and **from inside this one
file the two are indistinguishable**. The analyzer records the claim and the
ambiguity rather than dropping the claim (as it did before) or resolving it to a
built-in (as the corpus oracle did, which is a confidently wrong answer —
`libxml2/test/schemas/vdv-simpleTypes.xsd` declares its own `date` at line 32).

Resolving includes for real needs the include **graph**, which a per-file analyzer
cannot see and which belongs to a project-level pass. That is a feature, not a gap
in this function, and naming it as one would be a way of not doing it.

Each relationship carries `metadata.evidenceClass`, assigned where the edge is
written so a tier cannot drift from the rule that produced it:

| tier | edges | count on the corpus |
| --- | --- | ---: |
| `structural` | containment read off the tree, DTD→declaration, declaration→notation, PI→target | the large majority |
| `import_based` | the target is a FILE: `ExternalID`, stylesheet `href`, `schemaLocation` | 964 |
| `reference_qualified` | the target is a NAME reached through a declared prefix, or a named XSLT template | 11,145 |
| `usage_contextual` | the document stating what an element MAY contain through an attribute, e.g. `<!ELEMENT catalog (entry+)>` | 665 |
| `inferred` | the honest default for a role the table does not name | 0 |

`evidenceClass` is the tier of the edge's **primary** role. A merged edge carries
its other roles in `meta.alsoRoles`, and their tiers are not separately recorded —
so a consumer asking "is this edge *also* a usage claim?" has to read
`alsoRoles`, not `evidenceClass`.

That is not a hypothetical: `<!ELEMENT catalog (entry+)>` inside a document that
also contains a real `<entry/>` produces `contains catalog -> entry` twice — once
read off the tree, once from the DTD — and the two collapse onto one edge because
edge identity is `source|type|target`. Whichever rule wrote first becomes the
primary role. Measured over 2,500 corpus files: **665** content-model edges carry
`tier: usage_contextual`, and a further **148** carry `tier: structural` with
`alsoRoles: ["dtd_content_model"]`. So the content-model claim is never *lost* —
it is counted and preserved — but on 148 of 813 sites the edge's own tier
describes the tree reading rather than the usage one.

`dtd_notation_reference` also maps to `usage_contextual` and is exercised by
`xml/dtd-declarations`, but it occurs **zero** times across the 8,889-file corpus.
The tier is reachable; it is not common.
`<!ELEMENT catalog (entry+)>` says catalog MAY admit entry; `contains
catalog -> entry` read off an actual `<entry/>` child is nesting. They are
different claims, and because edge identity is `source|type|target` they collapse
onto one edge. The collapse is counted, not hidden: the edge records
`meta.occurrences`, `meta.lines`, and `meta.alsoRoles`, so every contributing
rule and every contributing line survives the merge.

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

The XML analyzer has **zero regex usages**, and the machine census agrees: 0 XML
entries, 0 missing, 0 stale, 0 unclassified, out of 28 classified usages across
43 analyzers.

That agreement was not free, and the disagreement is worth recording. This
section claimed zero while the census reported **1** —
`value.split(/\s+/)` at the `schemaLocation` handler, classified
`needs_review` with an **empty justification**. The doc had been written when the
claim was true and never re-checked against the machine that can disprove it; the
census had been right the whole time and the prose had drifted.

`schemaLocation` is the one attribute whose value is a token list rather than a
single name, so it is the only place a value has to be cut into words. That is now
a char walk over space, tab, LF, CR — the XML `S` production, spelled out so the
behaviour is pinned to a stated character set rather than to a regex dialect,
matching the house idiom in `real-groovy-analyzer.ts`. The tree supplies the
attribute name and the value node; only the tokenisation changed, and the emitted
edges are byte-identical (contract 90/90 and fixtures 8/8 unchanged across the
edit).

Attribute names, element names, namespace URIs, and QNames are all read from tree
nodes. Nothing is read by scanning source text.

## Complexity envelope

Evidence: `validation/m12/results/xml-corpus-complexity.json`.

| Run | files | symbols | relationships | wall ms | files/s | symbols/s | relationships/s | errors | crashes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Grails XML/XSD corpus (superseded) | 154 | 6,195 | 2,388 | 2,188.9 | 70.36 | 2,830.24 | 1,090.98 | 0 | 0 |
| CXF archetypes, all seven globs | 2,439 | 184,388 | 76,455 | 268,928 | 9.07 | 686 | 284 | 0 | 0 |

The second row is 16x the file count and 30x the symbol count of the first, and
it is the honest figure: the first row measured only `*.xml`/`*.xsd` and so
excluded every `.dtd`, `.xsl`, `.xslt`, `.rng`, and `.wsdl` file, which is most of
what a real corpus contains. Peak RSS 298 MB, single process, no database writes. The symbol and
relationship totals are stable across runs; the rates move a few percent with
machine load, which is why the gate's perf budget takes the minimum over repeated
timed runs rather than one measurement.

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
- Contract probe: `validation/m12/results/xml-contract.json` — 90/90
- Shape safety: `validation/m12/results/xml-shape-safety.json` — 10 checks, and
  16/16 analyzer node references live with 0 dead defensive references

The 49/49 figure is the small-fixture ground truth and is unaffected by what
follows. It should not be quoted as though it were the corpus result.

### The corpus differential, and why its recall is not reported

A second, larger instrument — `$HOME/fixtures/xml/probes/corpus-differential.mts`,
**outside version control** — builds an **independent oracle** from the parse tree and compares class by class
over the whole manifest. Its last full run reported the analyzer emitting 657,432
symbols and 228,194 relationships, 228,194/228,194 of them carrying a line, 0
symbols without an owner, 0 names containing whitespace or NUL, and 0 files
unrouteable.

**Those figures predate the M18 entity-reference work and are not current.** The
analyzer now emits `entity_reference` edges, so the relationship count moved and
this run has not been redone. Quoting it as the analyzer's present output would be
quoting a measurement of a build that no longer exists; the honest state is that
the number is stale and the re-measure is owed (see `reviews/xml/master-review.md`,
owed item 9). The **in-repo** M14 differential, by contrast, is pinned and current:

```
grails-core:xml  files=60  truth=1487  covered=1487 (100%)
                MISSING=0  analyzer-edges=1099  unexplained=0 (0%)  17.5 ms/file
full grails-core sweep: 314 files, missing=0, unexplained=0
```

That lane's coverage is `contains` only, and it rests on **one corpus of six** —
`maven` is 0/0 over 3,250 files, while `libxslt` (2,012 / 1,377), `libxml2`
(3,281 / 4,244), `cxf` (602 / 319) and `docx4j` (548 / 192) disagree, dominated by
DTD/XSD declaration classes the oracle does not derive. That is oracle coverage
rather than analyzer defects, and it is the largest piece of work left on the lane.

It also reports `contains-attribute` recall **0.910** and 76,372 spurious
relationships, and **both numbers are the oracle's error**. On
`grails-context.xsd` its namespace histogram is `[["…XMLSchema",1],["(none)",61]]`
— it resolved the XSD namespace for 1 of 62 elements and therefore published
owners as `xsd:element` where the analyzer correctly published `component-scan`.
Every "spurious" edge was that one scoping defect.

So the recall figure is not reported as a finding, and the oracle-free check
replaces it:

> **one symbol per `element` node in the tree, one per `Attribute` node, per
> file, equal on both sides, no tolerance.**

This is stronger than a recall percentage. It cannot be satisfied by publishing
the wrong *name*, and it cannot be satisfied by publishing anything *twice* — a
differential recall of 1.000 would pass both of those failures. It runs over 12
sources (39 elements, 40 attributes, all exact), and the gate's self-test carries
a mutation that loses an element and another that duplicates an attribute, so it
is known to be able to fail: **11/11 mutations caught**.

Two implementations disagreeing is evidence about both. A percentage computed
against a broken second implementation is a lie with a decimal point.

Still owed, and deliberately not claimed: the differential's 25 line mismatches
and 20,904 repeated identity keys, each of which has to be adjudicated against
the tree before it can be called a defect — the instrument that produced them is
the one shown above to be wrong.

## Corpus validation

- Manifest: `$HOME/fixtures/xml/repositories/MANIFEST.json` (also outside version control) — six repositories at pinned
  revisions, 8,889 tracked files over seven globs (`*.xml`, `*.xsd`, `*.dtd`,
  `*.xsl`, `*.xslt`, `*.svg`, `*.rng`), deterministic lexicographic order.
  grails-core's 314 are 146 xml + 9 xsd + 4 dtd + 155 svg, so a lane that measured
  only `*.xml`/`*.xsd` was measuring 49% of the corpus it claimed. `*.wsdl` is
  NOT in the set: the engine does not claim it, and 805 such files are recorded
  as unrouted under the M60 #913 ruling to refuse rather than claim
- Pinned: grails-core `334007a`, docx4j `0e8e763`, libxml2 `c43dc98`, maven
  `d296cc33`, cxf `e43776be`, libxslt `ec95343`
- Error acceptance, grails 314 files: **0 unexpected error files, 0 crashes**,
  with **4 declared negative controls** — a file that MUST produce errors and did,
  so a gate that stopped parsing would fail rather than report zero
- Throughput acceptance, cfx 2,439 files: **0 unexpected error files, 0 crashes,
  21 declared negative controls**
- Evidence: `xml-corpus-errors.json`, `xml-corpus-complexity.json`,
  `xml-corpus-shapes.json`

The negative controls are the part that makes the zero meaningful. An error gate
that measures zero cannot tell "parsed everything" from "parsed nothing", so each
run names files that are expected to fail and fails the run if they succeed.
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
- Corpus differential: `fixtures/xml/out/corpus-differential.json`, runner
  `fixtures/xml/probes/corpus-differential.mts`. **These two are outside version
  control** — `fixtures/` is a sibling worktree at `$HOME/fixtures/`,
  not a path relative to this repository, so the bare form above reads as a repo
  path and resolves to nothing. 35 probe files and 32 output files live there and
  are **not** reproducible from a clone; the durable ones still need moving in.
  The M14 in-repo gates below do not have this problem, which is the reason the
  numbers above are quoted from those and not from these.
- Lane registration and per-language record: `script/m14/completeness-inventory.ts`
  → `script/m14/spec/xml-completeness.json`, emitted by
  `script/m14/emit-xml-completeness.ts`
- M14 fixtures: `validation/m14/fixtures/xml/` (15), mutants via
  `script/m14/mutate-analyzer.ts` (16, all caught)
- Declared-name line contract: `script/m12/xml-declared-name-lines.mts` — 8,889
  files, 52,651 declaration anchors, **0 mis-anchored**; 43 offenders and exit 1
  with the fix reverted
- Encoding recovery: `script/m12/xml-encoding-recovery.mts` — 22 files, 1,537
  symbols, 229 relationships, **with the predicate written into the script**
- Grammar provenance: `grammars/tree-sitter-xml/PIN.md`, verified by
  `script/m14/verify-grammar-pins.ts`
- Evidence scripts: `script/m12/xml-corpus-errors.ts`,
  `xml-corpus-measure.ts`, `xml-node-types-compare.ts`,
  `xml-contract-probe.ts`, and `regex-census.ts`

## Where a declaration's line comes from

A vocabulary declaration is written in an **attribute**, and a formatted document
routinely puts that attribute — or the value itself — on a different line from the
tag that opens the declaration:

```xml
<xsl:with-param          ← not where the name is
    name="content"      ← the name
```

A symbol and a `contains` edge therefore report **the line carrying the value**,
not the line carrying the tag:

| shape | anchor | example |
| --- | --- | --- |
| attribute and value on one line | the `Attribute` | `<xsd:attribute name="x" type="…"/>` |
| attribute and value on different lines | the `AttValue` | `<xsd:element name=` ⏎ `"InvalidModificationFault"` (`cxf/wsn/wsdl/rp-2.xsd`) |
| value with surrounding whitespace | the line carrying it, after the trim XSD value normalization performs | `name=" xmlns"` (`libxml2/…/spectest.xml`) |

The **structural** span is not lost. `metadata.elementRange` carries the element's
own range whenever a declared name was used, so a consumer that wants "where does
this element start" has it and a consumer that wants "where is this name written"
has `range`. Before this the two readings shared one field and one of them had to
be wrong.

Gated by `script/m12/xml-declared-name-lines.mts`, which reads the analyzer's
output and goes back to the **source text** — it cannot tell a wrong line from a
right one by agreeing with the analyzer. Pinned by fixture
`xml/xsd-declared-name-lines` (all three shapes) and mutant
`xml/declared-name-anchored-to-the-tag`.

This is the same rule as the `ExternalID` line contract above and the `#861` web
family finding, reached from the declaration side.

### The two grammar repairs

`grammars/tree-sitter-xml/` is vendored and patched, not consumed as an upstream
blob. Both defects are in the **grammar**, not in the analyzer, and neither is
reachable from an analyzer workaround — the tree does not contain the nodes:

1. **`common/scanner.h`** — the scanner ran a failing `advance_if_eq('\n')` on a
   PI's trailing whitespace, consuming the character on failure and losing text.
   Replaced with a non-failing `skip_if_eq`.
2. **`xml/grammar.js`** — `_intSubsetItem` was defined but unreachable, so an
   internal DTD subset's conditional section was not parsed as a conditional
   section. Added the rule and wired it into `conditionalSect`.

The pre-repair wasm is provably an **unmodified, current upstream v0.7.0 build**:
its enumerable surface is 143 ids / 51 named / 2 fields, a wasm built from
upstream HEAD has the same surface with a zero set difference in both directions,
and behaviour is identical on all 29 constructs of the A/B battery. The repairs
were therefore necessary rather than opportunistic.

Corpus A/B, 8,888 files / 6.69M nodes: 31 files repaired, 2 moved, 8,855
unchanged. MISSING nodes fell 32 → 10. Both movements were adjudicated as
standalone-DTD and libxml2 negative controls, not as repairs. Independently, the
16-case expat oracle agreed on 16/16 accepts and rejects, which is what retracted
an earlier third "defect" that a hand-read of one file had suggested.

## Issue

M12.35 / GitHub issue #174.
