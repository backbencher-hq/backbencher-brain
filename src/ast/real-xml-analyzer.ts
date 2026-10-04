import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * XML analyzer backed exclusively by the vendored tree-sitter-xml AST.
 *
 * The grammar exposes XML as a `document` containing `element` nodes. Element
 * names and attributes are direct children of `STag` or `EmptyElemTag`; DTD
 * declarations live below `prolog/doctypedecl`; processing instructions are
 * `PI` nodes. No source-text search is used for declaration extraction.
 *
 * ── M60 XML lane ───────────────────────────────────────────────────────────
 * Four properties this analyzer now holds, each pinned by a measurement recorded
 * in `reviews/xml/master-review.md`:
 *
 * 1. DECLARED, NOT DISCOVERED. Every node type the analyzer acts on is
 *    enumerated in `DECLARED`, and the completeness gate refuses any dispatch
 *    site outside that set. Nothing is reached by a bare `else`, so a node type
 *    that occurs in a real corpus and is neither declared nor classified as a
 *    pass-through literal is a RED GATE, not a silent hole.
 *
 * 2. EVERY `contains` TARGET IS A PUBLISHED SYMBOL. The lane rule "no unknown
 *    symbols" is enforced structurally: a `contains` edge may only name a symbol
 *    this analyzer has already published, or one it publishes in the same pass.
 *    That is why a DTD content-model member and a notation name get a symbol —
 *    without it the edge would point at nothing. `references` and `imports` are
 *    deliberately EXEMPT: a reference whose target lives in another document is
 *    the normal case, and its metadata records whether the target resolves here.
 *
 * 3. THE LINE IS THE TARGET'S LINE (M59.A7 / #825). `addRelationship` takes the
 *    node the TARGET NAME IS WRITTEN ON, never the node the construct starts
 *    at. `<!DOCTYPE a PUBLIC "…" "…/a.dtd">` spans lines; the path is on the
 *    last one, and the edge has to point there.
 *
 * 4. COLLAPSE IS COUNTED, NOT HIDDEN. Edge identity in this graph is
 *    `source|type|target`, so N declarations of one pair necessarily share one
 *    edge. The analyzer no longer lets the first line stand in for all of them:
 *    the edge keeps the first line and carries `occurrences` and `lines`, so the
 *    loss is countable instead of invisible.
 */
export class RealXmlAnalyzer implements ASTEngine.LanguageAnalyzer {
  /**
   * Every node type this analyzer acts on, and why. The F8 completeness gate
   * compares this against the analyzer's dispatch sites AND against the node
   * types observed in a real corpus, so a type that appears in the corpus, is
   * not declared here, and is not a pass-through literal is a red gate.
   */
  public static readonly DECLARED: Record<string, string> = {
    document: "walk root; the root element is reached through the walk",
    prolog: "container: XMLDecl, doctypedecl and the misc PIs/comments under it are dispatched from here",
    element: "the document's structural unit: a symbol plus a `contains` edge from its parent element",
    STag: "start tag: carries the element Name and the Attribute list",
    EmptyElemTag: "empty tag: carries the element Name and the Attribute list",
    Name: "the name-bearing leaf for tags, attributes, PIs, DTD declarations and notations",
    Attribute: "a property of its element, and the source of `references` / `imports` edges for its value",
    doctypedecl: "a Type symbol naming the DTD, plus its ExternalID import",
    ExternalID: "a file reference on a doctypedecl, entity or notation",
    SystemLiteral: "the file path inside a SYSTEM ExternalID",
    PubidLiteral: "the public identifier inside a PUBLIC ExternalID",
    elementdecl: "a Type symbol for a DTD element declaration; its contentspec is the content model",
    AttlistDecl: "the element whose attributes are declared here",
    AttDef: "a Property symbol plus a `contains` edge from the element it is declared for",
    GEDecl: "a general entity declaration: a Type symbol owned by the DTD, plus its ExternalID import",
    PEDecl: "a parameter entity declaration: a Type symbol owned by the DTD, plus its ExternalID import",
    NotationDecl: "a notation declaration: a Type symbol owned by the DTD, plus its ExternalID import",
    PublicID: "a file reference on a NotationDecl",
    NDataDecl: "the notation an unparsed entity points at: a `contains` edge",
    contentspec: "the content model of an element declaration; each Name leaf becomes a `contains` edge",
    NotationType: "the notations an attribute may carry: each Name leaf becomes a `contains` edge",
    PI: "a processing instruction: a Module symbol owned by its enclosing element",
    PITarget: "the name-bearing leaf of a PI",
    StyleSheetPI: "a file reference: the PI spelling the `xml-stylesheet` external token produces",
    XmlModelPI: "a file reference: the PI spelling the `xml-model` external token produces",
    PseudoAtt: "a pseudo-attribute of a StyleSheetPI / XmlModelPI",
    PseudoAttValue: "the value of a pseudo-attribute; `href` is a file path",
  }

  /**
   * Node types the walk deliberately walks THROUGH without acting on them. The
   * F8 gate requires every observed named type to be in `DECLARED` or here; the
   * value is the reason, so a pass-through is a decision on record and not a
   * shrug.
   */
  public static readonly PASSTHROUGH_LITERALS: Record<string, string> = {
    XMLDecl: "`xml` is reserved; version and encoding are not declarations",
    Comment: "not a declaration",
    CharData: "text, not a declaration",
    CData: "text, not a declaration",
    CDSect: "wrapper around CData",
    CDStart: "wrapper for `<![CDATA[`",
    CharRef: "a numeric character reference, not a name",
    EntityRef: "a USE; the declaration is GEDecl / PEDecl",
    PEReference: "inside an internal subset a PEReference is a DeclSep — a separator, not a use",
    content: "an element's child sequence: walked through so each child element is reached; nothing on it is a name",
    conditionalSect: "an INCLUDE/IGNORE section inside an internal subset; walked through so the declarations it guards are reached",
    VersionNum: "the version pseudo-attribute literal inside an XMLDecl, not a name",
    EncName: "the encoding pseudo-attribute literal inside an XMLDecl, not a name",
    URI: "the aliased body of a SystemLiteral; the edge target is the enclosing literal, and the LITERAL carries the edge line",
    _intSubsetItem: "hidden rule; the repeat that carries a subset's declarations and conditional sections",
    ETag: "the repaired grammar rejects a mismatched end name, so the name adds nothing",
    AttValue: "read by the Attribute branch",
    Mixed: "`(#PCDATA|a|b)*` — the names are read from the Name leaves, not the wrapper",
    children: "the element content model; its Name leaves are the declarations that matter",
    Nmtoken: "an enumeration member is a token, not a name",
    Enumeration: "wrapper over the Nmtokens of a DTD attribute type",
    StringType: "the literal CDATA, not a name",
    TokenizedType: "the literal ID / IDREF / … token, not a name",
    DefaultDecl: "the literal #REQUIRED / #IMPLIED / #FIXED value, not a name",
    EntityValue: "an entity's replacement text, not a name",
  }

  /**
   * Namespaces whose members are specification built-ins rather than project
   * symbols. A `type="xsd:string"` reference is real and is emitted, but it is
   * marked `resolvable: "builtin"` and never published as a phantom symbol —
   * recording a `string` symbol that no document in the corpus declares is the
   * M60.R10 "a value where a name belongs" class of lie.
   */
  /**
   * WHERE A DECLARATION'S NAME ACTUALLY LIVES, per vocabulary.
   *
   * In a schema language the DECLARED NAME of a construct is the VALUE of its
   * `name` attribute, not its tag name: `<xs:complexType name="RootType">`
   * declares the type `RootType`. An analyzer that publishes the tag name files
   * every type in a project under one symbol — `xsd:element` alone appears 5,914
   * times in this corpus — and makes the search a developer actually types,
   * `bb_search("RootType")`, return nothing at all.
   *
   * The rule is gated on the element's EFFECTIVE NAMESPACE and on a DECLARED set
   * of local names, and both halves are load-bearing:
   *
   *   · tag-only gating is wrong, and measurably so. Outside a declaration
   *     vocabulary 29,196 elements carry a `name` attribute in this corpus and
   *     nearly all of them are DATA: `<property name="wsdl.dir">`,
   *     `<target name="client">`, a POM's `<name>` display label. Renaming those
   *     would publish a data value as a graph symbol.
   *   · `rng:ref name="…"` is a REFERENCE, not a declaration, so it is
   *     deliberately absent from the RelaxNG set; and because the value carries
   *     no prefix the QName pass cannot see it either. That gap is DECLARED here
   *     rather than left silently open.
   *
   * XSLT's local bindings (`xsl:variable`, `xsl:param`, `xsl:with-param`) are
   * included: they are named, they are scoped to the enclosing template, and the
   * walk already carries that owner.
   */
  private static readonly DECLARATION_VOCABULARIES: Readonly<Record<string, ReadonlySet<string>>> = {
    "http://www.w3.org/2001/XMLSchema": new Set([
      "element", "attribute", "complexType", "simpleType", "group", "attributeGroup",
      "notation", "key", "keyref", "unique",
    ]),
    "http://relaxng.org/ns/structure/1.0": new Set([
      "grammar", "define", "element", "attribute", "group", "data", "value", "text",
      "list", "div", "except", "name", "externalRef",
    ]),
    "http://www.w3.org/1999/XSL/Transform": new Set([
      "template", "attribute-set", "key", "decimal-format", "character-map", "output",
      "strip-space", "preserve-space", "variable", "param", "with-param", "function",
    ]),
    "http://schemas.xmlsoap.org/wsdl/": new Set([
      "definitions", "binding", "portType", "message", "service", "port", "operation",
    ]),
  }

  /**
   * ATTRIBUTE NAMES whose unprefixed value names a declaration.
   *
   * A PREFIX is the primary signal and needs no table: a value written `tns:X`
   * names a declaration, and the census over 3,000 corpus files puts 14,479 such
   * occurrences on real naming attributes (`type` 7,770, `ref` 1,903, `base`
   * 1,608, Spring's `serviceName` 1,526 and `endpointName` 1,516, …). A prefixed
   * value is a reference wherever it appears.
   *
   * An UNPREFIXED value is not, and the first version of this rule treated it as
   * one, which is the M60.R10 class in reverse: the census counted 9,391 bare
   * `key="…"` values that are property names, 4,453 `use="optional|required"`,
   * 1,404 `maxOccurs="unbounded"`, 14,023 `value="…"` and 2,157 `w:val="Normal"`,
   * and the analyzer published references to names like `unbounded` and `Normal`
   * that nothing declares as a type. So an unprefixed value is a reference only
   * on an attribute in this set, and the set is the DECLARATION (this is the
   * M60.R10 target-spelling register, per-vocabulary, with the census above as
   * its evidence).
   */
  private static readonly REFERENCE_ATTRIBUTES: ReadonlySet<string> = new Set([
    // XSD 1.0 §4.2 / §3.4.3 / §3.4.4 — the four attributes whose value is a type
    // or element reference by definition.
    "type", "base", "ref", "itemType", "memberTypes", "substitutionGroup", "refer",
    // WSDL 1.1 §3.5 / §3.6, and the SOAP binding's own reference attributes.
    "portType", "binding",
    // RelaxNG: a `name` on a `ref` names another pattern, not this one. The
    // DECLARING uses of `name` (`rng:element`, `rng:attribute`) are handled by
    // the declared-name rule and must not also become references, which is why
    // `name` is NOT in this set and `rng:ref` is named explicitly below.
    "pattern",
  ])

  /**
   * XSLT and RelaxNG name ONE construct by an attribute the generic set cannot
   * carry, because the attribute is `name` and `name` is a DECLARATION on every
   * sibling construct. Declared explicitly for that reason, and each is pinned by
   * a fixture with its sibling case pinned the other way.
   *
   * `call-template` WAS here and was removed, and the removal is the M60
   * ontology finding rather than a tidiness change. XSLT 1.0 §6 Named Templates
   * is unambiguous about the construct:
   *
   *     "An xsl:call-template element INVOKES A TEMPLATE BY NAME; it has a
   *      required name attribute that identifies the template to be invoked."
   *
   * and a named template is the only procedure the XML family has: it takes
   * parameters (§11.6), is invoked by name, and returns a result tree fragment.
   * Labelling that edge `references` says the document MENTIONS a name, when the
   * document says it CALLS one — a `calls` edge existed in the ontology and the
   * vocabulary was withholding it. So `call-template` emits `calls` (see
   * `XSLT_CALL_ELEMENTS`), and `apply-templates` stays a `references` edge
   * because XSLT 1.0 §5.4 gives `xsl:apply-templates` NO `name` attribute at
   * all — §6 says so outright: "the name attribute on an xsl:template element
   * does not affect whether the template is invoked by an xsl:apply-templates
   * element". A dispatch by pattern and mode is not a call.
   */
  private static readonly NAMED_REFERENCE_ELEMENTS: Readonly<Record<string, ReadonlySet<string>>> = {
    "http://www.w3.org/1999/XSL/Transform": new Set(["apply-templates"]),
    "http://relaxng.org/ns/structure/1.0": new Set(["ref"]),
  }

  /**
   * The XSLT instructions whose `name` attribute names a template that is
   * INVOKED, which is a `calls` edge and not a `references` one.
   *
   * `xsl:call-template` is the whole list, and deliberately so. `xsl:apply-imports`
   * (§5.6) invokes the rule a stylesheet overrides, but it names it by nothing —
   * it takes no `name` — so there is no edge to write. `xsl:apply-templates`
   * dispatches by pattern and mode and, in XSLT 1.0, carries no `name`.
   */
  private static readonly XSLT_CALL_ELEMENTS: ReadonlySet<string> = new Set(["call-template"])

  /**
   * XSLT names a template at its definition and calls it by that name, so `name`
   * on these two is a REFERENCE to a declaration elsewhere in the same document.
   * The QName pass cannot see it: the value carries no prefix, so it is not a
   * QName. Declared explicitly, for the same reason.
   */
  private static readonly XSLT_NAMED_TEMPLATE_REFERENCES: ReadonlySet<string> = new Set([
    "call-template", "apply-templates",
  ])

  /**
   * The M14 Matrix 1d evidence tier for each edge CLASS, assigned where the edge
   * is written so a tier cannot drift from the rule that produced it.
   *
   *   structural         the parent/child or declaration/member relation is READ
   *                       off the tree — the fact needs nothing outside the file
   *   import_based       the target is a FILE, taken from a path the document
   *                       itself writes
   *   reference_qualified the target is a NAME reached through a declared
   *                       namespace prefix, or an XSLT named template reached by
   *                       its declared name
   *   usage_contextual   a containment the document states through an attribute
   *                       rather than through nesting — the DTD content model and
   *                       the NOTATION attribute type, which are the document
   *                       saying what an element MAY contain
   *   inferred           the edge is a reading the analyzer supplies and the
   *                       document does not state outright
   *
   * XML emitted no tier at all before this, so the lane's Matrix 1d cell was
   * silent; the completeness gate's section D now pins four of the five.
   */
  private static readonly EVIDENCE_TIER: Readonly<Record<string, string>> = {
    xml_element: "structural",
    xml_attribute: "structural",
    xml_namespace: "structural",
    dtd_element_declaration: "structural",
    dtd_attribute_declaration: "structural",
    dtd_content_model: "usage_contextual",
    dtd_notation_reference: "usage_contextual",
    dtd_ndata_notation: "structural",
    dtd_entity_declaration: "structural",
    dtd_parameter_entity_declaration: "structural",
    dtd_notation_declaration: "structural",
    processing_instruction: "structural",
    pseudo_attribute: "structural",
    doctype_external_id: "import_based",
    entity_external_id: "import_based",
    parameter_entity_external_id: "import_based",
    notation_external_id: "import_based",
    processing_instruction_href: "import_based",
    schema_location: "import_based",
    attribute_qname_reference: "reference_qualified",
    // An XSLT named template INVOKED by name. `reference_qualified` because the
    // document names its target — that is what makes the call resolvable — and
    // not `structural`, because the tree says nothing about which template an
    // instruction invokes until the name is read.
    xslt_named_template_call: "reference_qualified",
    // XSD type derivation, `xs:extension`/`xs:restriction` `base=`. `structural`:
    // the vocabulary element IS the declaration of the relation, so the fact needs
    // nothing outside the file, exactly as a parent/child edge does.
    xsd_derivation_base: "structural",
    // XSLT 1.0 §5.5 competing template rules. `structural`, not `inferred`: both
    // declarations and the three attributes that make them compete are read straight
    // off the tree, and the only thing the spec contributes is WHICH of two colliding
    // declarations wins — a direction, recorded in `metadata.derivation`, not a guess
    // about whether the relation exists. Leaving this role unmapped let `addRelationship`
    // label every one of these edges `inferred`, which is the tier the ontology census
    // counts as heuristic: a deterministic parse fact filed as a guess, and the census
    // row `tier inferred = 0` would have become false without anything changing in the
    // analyzer's behaviour.
    xslt_competing_template_rule: "structural",
    // An entity use is reached through a NAME in the document's own DTD, not
    // through a declared namespace prefix — but it is a reference to a
    // declaration all the same, and `usage_contextual` would say the document is
    // only *using* the entity, which understates it: `&logo;` in content means the
    // element's value IS that entity's replacement text. `reference_qualified` is
    // the same claim an XSLT named-template call makes.
    entity_reference: "reference_qualified",
    xslt_named_template_reference: "reference_qualified",
  }

  private static readonly BUILTIN_NAMESPACE_URIS: ReadonlySet<string> = new Set([
    "http://www.w3.org/2001/XMLSchema",
    "http://www.w3.org/XML/1998/namespace",
  ])

  /**
   * The five entities XML declares in EVERY document (XML 1.0 §4.6, "Entity
   * declarations"), whether or not a DTD mentions them.
   *
   * The same shape of knowledge as `BUILTIN_NAMESPACE_URIS` above and the
   * spec-bound prefixes below it, and needed for the same reason: the grammar
   * reports each of them as an `EntityRef`, and a pass with only "declared or
   * not" answers has to call all of them undefined. A document containing
   * `&lt;` is well-formed in every conforming parser, so `unresolved` on it is
   * not a cautious reading — it is a false claim about the document.
   *
   * Deliberately exactly five. `&nbsp;`, `&mdash;` and the rest of the HTML
   * entity set are NOT predefined; an XML document that uses one without
   * declaring it really does reference something undefined, and that stays
   * `unresolved`.
   */
  private static readonly PREDEFINED_ENTITIES: ReadonlySet<string> = new Set([
    "lt",
    "gt",
    "amp",
    "apos",
    "quot",
  ])

  /**
   * The two prefixes the Namespaces specification binds in EVERY document,
   * whether or not the document says so (XML Namespaces 1.0 §4, and the
   * Namespaces in XML 1.1 §2.2 which makes it a namespace name rather than a
   * reserved prefix). Neither may be declared to anything else: re-binding `xml`
   * is an error, and `xmlns` is bound to the XMLNS namespace.
   *
   * This table exists because a well-formed document CANNOT supply them, so a
   * resolver that only reads declarations can never resolve them. See M60 X8.
   */
  /**
   * The XML Schema built-in DERIVED types, from Part 2's own list. Written out
   * rather than derived, because the analyzer and the corpus oracle each keep
   * their own copy ON PURPOSE: two implementations that share a constant cannot
   * disagree, and a constant that cannot be disagreed with cannot find a defect.
   */
  private static readonly XSD_BUILTIN_TYPE_NAMES: ReadonlySet<string> = new Set([
    "anyType", "anySimpleType", "string", "boolean", "decimal", "float", "double",
    "duration", "dateTime", "time", "date", "gYearMonth", "gYear", "gMonthDay",
    "gDay", "gMonth", "hexBinary", "base64Binary", "anyURI", "QName", "NOTATION",
    "normalizedString", "token", "language", "NMTOKEN", "NMTOKENS", "Name",
    "NCName", "ID", "IDREF", "IDREFS", "ENTITY", "ENTITIES", "integer",
    "nonPositiveInteger", "negativeInteger", "long", "int", "short", "byte",
    "nonNegativeInteger", "unsignedLong", "unsignedInt", "unsignedShort",
    "unsignedByte", "positiveInteger", "dateTimeStamp", "dayTimeDuration",
    "yearMonthDuration", "lang", "space", "base", "id",
  ])

  private static readonly IMPLICIT_PREFIX_BINDINGS: Readonly<Record<string, string>> = {
    xml: "http://www.w3.org/XML/1998/namespace",
    xmlns: "http://www.w3.org/2000/xmlns/",
  }

  /**
   * Transient per-attribute context, set by the element branch before its
   * attributes run. `bareNameReference` — the element is one that NAMES another
   * declaration rather than being one (XSLT `call-template`, RelaxNG `ref`).
   * `bareNameDeclarationElement` — the element DECLARES through `name`
   * (RelaxNG `element`, `attribute`), so its `name` is a declaration and must not
   * also become a reference to itself.
   */
  private bareNameReference = false
  private bareNameDeclarationElement = false

  /**
   * The project's placeholder for an endpoint that could not be determined. Named
   * here rather than inlined so the refusal that uses it and the census that checks
   * it are reading the same string.
   */
  private static readonly PLACEHOLDER_LITERAL = "unknown"
  /** `xsl:call-template`: its `name` attribute names a template it INVOKES. */
  private xsltCallElement = false
  /** An XSD `extension`/`restriction`: its `base` attribute names a SUPERtype. */
  private xsdDerivationElement = false
  private derivationKind: "extension" | "restriction" = "extension"

  public analyze(rootNode: Node, content: string, _filePath: string): ASTEngine.ParseResult {
    this.bareNameReference = false
    this.bareNameDeclarationElement = false
    this.xsltCallElement = false
    this.xsdDerivationElement = false
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const seenRelationships = new Map<string, ASTEngine.UniversalRelationship>()

    /**
     * Names already published, so a `contains` edge never points at a symbol that
     * does not exist. Keyed `owner\u0000name` for members and `name` for top-level
     * declarations, matching how the graph resolves an edge target.
     */
    const publishedNames = new Set<string>()

    /**
     * xmlns prefix -> URI, SCOPED. An `xmlns:p` on one element must not resolve a
     * prefix on its sibling, so the map is snapshotted on the way DOWN an element
     * and restored on the way out — a two-entry stack in a worklist, not a
     * mutation that would leak a binding across a whole document.
     */
    const namespaceBindings = new Map<string, string>()
    const bindingScopes: { outer: Map<string, string> }[] = []
    /** Names this document declares, for `references` resolvability. */
    const declaredNames = new Set<string>()
    /**
     * Namespaces this document IMPORTS, and the file each came from.
     *
     * M60 finding X7: a `references` edge whose prefix is bound to a namespace
     * this document imports points at a component declared in ANOTHER FILE, and
     * the reference pass used to refuse it. The refusal is right for a prefix
     * bound to nothing — recording that would put a name in the graph that no
     * file supports, the M60.R10 "a value where a name belongs" lie. It is wrong
     * here, because the document already says where the name lives: the
     * `imports` edge for the same `xsd:import` names the file. Dropping the
     * reference left the graph claiming two documents are independent while
     * holding an edge that says one of them includes the other.
     *
     * So there are THREE resolvability classes, not two, and the third is the
     * one that makes a schema set a graph:
     *   in-document — the name is declared here
     *   builtin     — the name is an XML/XSD built-in type
     *   external    — the name is declared in a file this document imports, and
     *                 the edge records WHICH file, so a consumer can follow it
     */
    const importedNamespaces = new Map<string, { path?: string; element: string }>()

    /**
     * Attribute values that MAY name a declaration, held until the walk is over.
     *
     * The walk is a worklist, so it does not visit the document in reading
     * order, and a forward reference is the normal case in an XSD:
     * `<xs:element type="tns:RootType"/>` at line 12 names a `xs:complexType`
     * declared at line 20. Resolving on the spot would drop every forward
     * reference, which is most of them. So candidates are collected with the
     * namespace binding IN SCOPE AT THE ATTRIBUTE (a prefix bound by a sibling
     * element must not leak into this one) and decided after the last name is
     * known.
     */
    type ReferenceCandidate = {
      ownerName: string
      attributeName: string
      value: string
      nameNode: Node
      valueNode: Node
      binding: string | undefined
      /** The resolved namespace of the ELEMENT carrying the attribute. X11. */
      ownerNs?: string
      bareNameReference?: boolean
    }
    const referenceCandidates: ReferenceCandidate[] = []

    /**
     * NAMED-TEMPLATE CALLS — M60 ontology, the `calls` type this lane withheld.
     *
     * XSLT 1.0 §6: "An xsl:call-template element invokes a template by name; it
     * has a required name attribute that identifies the template to be invoked."
     * Collected and not decided, for the same reason the reference queue exists: the
     * template a call names is very often declared further down the stylesheet, and
     * deciding on the spot drops every forward call.
     */
    type CallCandidate = { ownerName: string; templateName: string; valueNode: Node; textNode: Node }
    const callCandidates: CallCandidate[] = []

    /**
     * XSD TYPE DERIVATION — `xs:extension base=` / `xs:restriction base=`.
     *
     * XSD 1.0 Part 1 §3.4.2 defines both elements with `base = xs:QName`, "the
     * qualified name of the base type", and calls the whole mechanism type
     * DERIVATION: the derived type's content model is the base's plus more
     * (extension) or a narrowing of it (restriction). Both are subtype relations,
     * which is what `extends` means in the ontology, so both emit `extends` rather
     * than the `references` this lane used to give every `base=` value.
     *
     * Same collection-then-decide shape, for the same reason: a schema's types are
     * declared in whatever order the author chose and a derived type routinely
     * precedes its base.
     */
    type DerivationCandidate = {
      ownerName: string
      value: string
      binding: string | undefined
      /** The namespace of the element carrying `base=`, for the X13 bare-value test. */
      ownerNs: string | undefined
      kind: "extension" | "restriction"
      valueNode: Node
      nameNode: Node
    }
    const derivationCandidates: DerivationCandidate[] = []

    /**
     * TEMPLATE NAMES THIS STYLESHEET DECLARES.
     *
     * Separate from `declaredNames` on purpose. `declaredNames` also holds the
     * shadow symbols `ensureTargetSymbol` publishes for resolvable references, so
     * asking it "is `render` declared?" would accept a `type` symbol invented for a
     * reference and publish `calls something -> render` pointing at a phantom.
     * A call target must be a real `xsl:template` declaration, so the set is fed
     * from the vocabulary declaration rule and nothing else.
     */
    const declaredTemplateNames = new Set<string>()

    /**
     * MATCH-BASED `xsl:template` DECLARATIONS, collected for the `overrides` pass.
     *
     * One row per `xsl:template` in the XSLT namespace that carries a `match`
     * attribute, keyed on the triple XSLT 1.0 §5.5 defines a template rule's identity
     * by: pattern, mode and priority. Two rows sharing a key are two declarations that
     * replace one another, which is the only sense this language has an override.
     *
     * Collected and not decided, for the same reason as `callCandidates`: a second
     * template may be declared anywhere later in the file, so a rule that decided on
     * sight would drop every forward declaration.
     */
    const competingTemplates: {
      key: string
      /** The `name` attribute's value when the template has one, else "". */
      declaredName: string
      match: string
      mode: string
      priority: string
      node: Node
      /** The `match` attribute node: the line the identity is written on. */
      anchorNode: Node
      /** The enclosing element's own symbol, so the derived identity is owned too. */
      ownerName: string | undefined
    }[] = []

    /**
     * ENTITY USES — M60 M18. `&name;` in content is a real reference to a
     * declared entity, and this analyzer emitted nothing for it.
     *
     * The grammar has an `EntityRef` node for exactly this and it was classified
     * as PASS-THROUGH with the note "a USE; the declaration is GEDecl /
     * PEDecl" — which is the observation that it is a use, followed by the decision
     * to record only the declaration. So the graph could say that entity `greeting`
     * is declared and nothing at all about which element's content depends on it.
     *
     * Measured over the corpus: **12,066 `EntityRef` sites across 268 files, of
     * which 4,423 name an entity NOTHING DECLARES.** A document containing
     * `&undefined;` indexed as clean. That is the same defect X13 fixed for bare
     * type references, in a different syntax: a claim the document makes, dropped
     * because the analyzer could not decide it, and the not-deciding was invisible.
     *
     * Deferred, for the same reason the QName pass is: an entity may be declared
     * after it is used, and resolving on the spot would drop every forward use.
     */
    const entityReferenceCandidates: { ownerName: string; name: string; node: Node; textNode: Node }[] = []

    /**
     * PARAMETER ENTITY REFERENCES, collected not decided, for the same reason the
     * `EntityRef` candidates are: a parameter entity may be declared after it is
     * used, so resolving on the spot would drop every forward reference — and
     * `%defroot;` before its `<!ENTITY % defroot …>` is a real thing documents do.
     */
    const parameterEntityReferences: {
      ownerName: string
      name: string
      node: Node
      textNode: Node
      /** The site sat inside a region the parser could not read. */
      recovery: boolean
    }[] = []

    /**
     * Names a `contains` edge is about to point at that this document may not
     * declare anywhere else: a DTD content-model member, a notation an attribute
     * may carry, the notation an unparsed entity points at.
     *
     * The edge is unconditional — the DTD really does say `a` admits `b` — but
     * the SYMBOL that makes the edge resolvable is not: `<!ELEMENT doc (src|dest)*>`
     * followed by `<!ELEMENT src EMPTY>` names `src` twice, and publishing the
     * shadow on the spot produced two `Type src` symbols for one identity
     * (measured on libxml2's `id3.xml`: three symbols for `(doc, src)`).
     * So the shadow is decided in the deferred pass, once every name is known,
     * and it is published only when nothing else already published that name.
     */
    type ShadowCandidate = {
      name: string
      ownerName: string | undefined
      node: Node
      metadata: Record<string, any>
      edge: { source: string; role: string; dtdName: string | undefined }
    }
    const shadowCandidates: ShadowCandidate[] = []

    let errorNodes = 0
    let missingNodes = 0

    const publish = (symbol: ASTEngine.UniversalSymbol, identity: string) => {
      symbols.push(symbol)
      if (identity) publishedNames.add(identity)
      return symbol
    }

    const addRelationship = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      metadata: Record<string, any>,
      /** The node the TARGET NAME IS WRITTEN ON (M59.A7 / #825). */
      targetNode?: Node | null,
    ) => {
      if (!source || !target) return
      // A construct never REFERENCES or IMPORTS ITSELF. `<xs:element name="root">`
      // carries the attribute `name="root"` — that attribute is the DECLARATION of
      // `root`, not a use of it, and without this the analyzer published
      // `references root -> root` and then invented a `type` symbol for the same
      // name (measured: 3 self-edges and 3 phantom symbols in a 20-symbol XSD).
      // A self-import is a defect in the document, not an edge to publish.
      //
      // `contains` is deliberately NOT covered, and the corpus says why: a DTD and
      // an element it declares routinely share a name — `<!DOCTYPE catalog [<!ELEMENT
      // catalog (entry+)>]>` is the ordinary spelling of "catalog is a catalog" —
      // and those are TWO DISTINCT DECLARATIONS. The first version of this rule
      // refused them too and lost the declaration entirely: the corpus fixture
      // `xml/dtd-declarations` pins `contains catalog -> catalog` and
      // `xml/conditional-section` pins it again at a different line, so a rule
      // that reads as a blanket invariant and is not one is now caught by a gate.
      //
      // The self-loop guard, and it applies to REFERENCES ONLY.
      //
      // It was `References || Imports`, on the reasoning that a thing cannot
      // reference or import itself. That is sound for a reference — a
      // declaration naming itself is a cycle in the document, not a link — and
      // unsound for an import, because the two ends of an `imports` edge are
      // DIFFERENT KINDS OF THING: `source` is a symbol name and `target` is a
      // path read out of a SYSTEM identifier. When the two strings coincide they
      // still denote a symbol and a file, and the file is real.
      //
      // `<!ENTITY emc2.gif SYSTEM "emc2.gif" NDATA GIF>` names a file called
      // `emc2.gif`. The guard dropped the edge, and dropped it ASYMMETRICALLY:
      // `extractExternalId` had already pushed the `ImportInfo` a few lines
      // earlier, so the file was present in `imports` and absent from the
      // relationship graph — the analyzer contradicting itself inside one call.
      // 46 such edges in the corpus, 4 of them entity external ids and the rest
      // notation external ids (`<!NOTATION GIF SYSTEM "GIF">`).
      //
      // Nothing is lost by dropping the guard from `imports`: there is no
      // "meaningless self-import" for it to prevent, since a file that is named
      // after the declaration that names it is still a second thing.
      if (type === ASTEngine.RelationshipType.References) {
        if (source === target) return
      }
      const key = `${source}\u0000${type}\u0000${target}`
      const line = targetNode ? targetNode.startPosition.row + 1 : undefined
      const role = metadata.role as string | undefined
      const existing = seenRelationships.get(key)
      if (existing) {
        // The graph's edge identity is the triple, so N declarations of the same
        // pair share one edge. Count the collapse rather than losing it silently.
        existing.metadata.occurrences = ((existing.metadata.occurrences as number | undefined) ?? 1) + 1
        // Two RULES can produce one edge, and the collapse must not lose which.
        // `<!ELEMENT catalog (entry+)>` (a content-model reading, so
        // `usage_contextual`) and `<entry/>` (a nesting reading, so `structural`)
        // are the same `contains catalog -> entry` pair, and the first one to fire
        // used to erase the other. The extra roles ride on `alsoRoles` beside the
        // extra lines, on the same principle: count the collapse, do not hide it.
        if (role && role !== existing.metadata.role) {
          const also = (existing.metadata.alsoRoles as string[] | undefined) ?? []
          if (!also.includes(role)) also.push(role)
          existing.metadata.alsoRoles = also
          // X14: `evidenceClass` is the tier of the PRIMARY role, so a consumer
          // asking "is this edge ALSO a usage claim?" had to know the tier table
          // and re-derive it. The roles were recorded and their tiers were not, so
          // `alsoRoles` was present but not QUERYABLE — the one thing a field
          // called "also" exists to be.
          //
          // Measured: 148 of 813 content-model sites carry `structural` on the
          // edge with `dtd_content_model` in `alsoRoles`, which is exactly the
          // 148 a consumer could not tell apart from 665 genuine nesting edges.
          //
          // An ARRAY OF OBJECTS rather than a second map keyed by role, so the
          // order of `alsoRoles` and the order of its tiers cannot disagree — a
          // map would have two independent orderings and no way to pair them
          // without trusting the reader to zip them. Position is the join key,
          // which is why `alsoRoles` is never re-sorted and never deduped
          // independently of this list.
          const tiers = (existing.metadata.alsoRoleTiers as { role: string; tier: string }[] | undefined) ?? []
          if (!tiers.some((t) => t.role === role)) {
            tiers.push({ role, tier: RealXmlAnalyzer.EVIDENCE_TIER[role] ?? "inferred" })
          }
          existing.metadata.alsoRoleTiers = tiers
        }
        // Seed from the EDGE's own line_number, not from a metadata key: the
        // relationship carries `line_number`, so reading `metadata.line` seeded
        // the list empty and the first occurrence's line was dropped. Measured on
        // a three-line fixture: occurrences 3, lines [3,4] — the line 2
        // declaration was unreachable.
        const lines = (existing.metadata.lines as number[] | undefined)
          ?? (existing.line_number !== undefined ? [existing.line_number] : [])
        if (line !== undefined) {
          if (!lines.includes(line)) lines.push(line)
          // The edge's own line is the EARLIEST line the target name is written
          // on, not merely the first one the walk happened to reach. The walk is a
          // LIFO worklist, so it does not visit a document in reading order, and a
          // deferred declaration edge can name a pair an on-the-spot element edge
          // already created: `<!ELEMENT catalog (entry+)>` on line 7 and
          // `<entry/>` on line 10 are one edge, and the DECLARATION site is the
          // better line to navigate to. Taking the first-processed line left this
          // edge pointing at the use.
          if (existing.line_number === undefined || line < existing.line_number) {
            existing.line_number = line
            existing.metadata.line = line
          }
        }
        lines.sort((a, b) => a - b)
        existing.metadata.lines = lines
        return
      }
      const relationship: ASTEngine.UniversalRelationship = {
        source,
        target,
        type,
        confidence: 1,
        line_number: line,
        // M14 Matrix 1d: the tier is a property of the RULE that produced the
        // edge, so it is stamped from a table keyed by that rule's role and an
        // unrecognised role is `inferred` — which is the honest default, because
        // a tier nobody can name is a reading the analyzer supplies rather than
        // one the document states.
        metadata: { ...metadata, occurrences: 1, evidenceClass: (role && RealXmlAnalyzer.EVIDENCE_TIER[role]) || "inferred" },
      }
      seenRelationships.set(key, relationship)
      relationships.push(relationship)
    }

    /** Publishes a name a `contains` edge is about to point at, if it is new. */
    const ensureTargetSymbol = (
      name: string,
      ownerName: string | undefined,
      kind: ASTEngine.SymbolKind,
      node: Node | null,
      metadata: Record<string, any>,
    ): string => {
      if (!name || !node) return name
      // If this document ALREADY published a symbol with this name — as a
      // `class` element, a DTD entity, a notation, a content-model member — then
      // the edge target already resolves, and publishing a second, unowned
      // `type` symbol beside it is a duplicate, not a reference. Measured on a
      // 20-symbol XSD: three such shadows, one per referenced type.
      if (declaredNames.has(name)) return name
      const identity = ownerName ? `${ownerName}\u0000${name}` : name
      if (publishedNames.has(identity)) return name
      publish(
        {
          name,
          kind,
          range: this.nodeToRange(node),
          visibility: "public",
          ownerName,
          ownerKind: ownerName ? ASTEngine.SymbolKind.Type : undefined,
          qualifiedName: ownerName ? `${ownerName}.${name}` : name,
          metadata: { ...metadata, nodeType: node.type },
        },
        identity,
      )
      declaredNames.add(name)
      return name
    }

    // Syntax errors are collected centrally by ASTEngine so the tree-level
    // warning is emitted exactly once; this analyzer never duplicates it. It
    // still COUNTS them, because a symbol published from a file the analyzer
    // then reports as erroneous has to say so on the symbol.

    type WorkItem = { node: Node; ownerName?: string; dtdName?: string; bindDepth?: number }
    const work: WorkItem[] = [{ node: rootNode }]

    while (work.length > 0) {
      const { node, ownerName, dtdName, bindDepth } = work.pop()!
      // Leaving an element's subtree: put the outer namespace map back.
      while (bindingScopes.length > (bindDepth ?? 0)) {
        const scope = bindingScopes.pop()!
        namespaceBindings.clear()
        for (const [k, v] of scope.outer) namespaceBindings.set(k, v)
      }
      if (node.isMissing) {
        missingNodes++
        continue
      }
      if (node.isError) errorNodes++

      if (node.type === "element") {
        const tagNode = this.findDirectChild(node, "STag") || this.findDirectChild(node, "EmptyElemTag")
        const nameNode = tagNode ? this.findDirectChild(tagNode, "Name") : null
        const name = nameNode?.text.trim()
        if (name && tagNode) {
          // Bind this element's own namespaces, resolve what THEY mean, and put
          // the outer map back when this subtree is done.
          bindingScopes.push({ outer: new Map(namespaceBindings) })
          this.rememberNamespaces(tagNode, namespaceBindings)

          const colon = name.indexOf(":")
          const prefix = colon >= 0 ? name.slice(0, colon) : ""
          const localName = colon >= 0 ? name.slice(colon + 1) : name
          const effectiveNamespace = namespaceBindings.get(prefix) ?? (colon < 0 ? namespaceBindings.get("") : undefined)
          const declaration = this.declaredNameOf(effectiveNamespace, localName, tagNode)
          const declaredName = declaration?.name
          const symbolName = declaredName ?? name

          const elementSymbol: ASTEngine.UniversalSymbol = {
            name: symbolName,
            kind: ASTEngine.SymbolKind.Class,
            // M19 (master review, 2026-09-29): a VOCABULARY DECLARATION is written
            // on its `name=` attribute, not on the tag that opens it, and the two
            // are routinely on DIFFERENT LINES. Measured over the 2,500-file
            // blast radius: 4 of 19,852 declarations reported the tag's line, so
            // a search for the symbol landed on `<xsl:with-param` rather than on
            // `name="content"` a line below. The symbol's range therefore starts
            // at the ATTRIBUTE, while `elementRange` below keeps the structural
            // span so a reader can still find the element itself. Before this the
            // two readings shared one field and one of them had to be wrong.
            range: declaration ? this.nodeToRange(declaration.nameNode) : this.nodeToRange(node),
            visibility: "public",
            ownerName,
            ownerKind: ownerName ? ASTEngine.SymbolKind.Class : undefined,
            qualifiedName: ownerName ? `${ownerName}.${symbolName}` : symbolName,
            metadata: {
              nodeType: "element",
              isXmlElement: true,
              tagName: name,
              isSchemaConstruct: this.isSchemaConstruct(name),
              // The DECLARED name, when the vocabulary puts it in the `name`
              // attribute. `tagName` stays the tag, so the structural reading is
              // carried rather than overwritten.
              ...(declaration
                ? { isVocabDeclaration: true, declaredName: declaration.name, declarationKind: localName, declaredByAttribute: declaration.attribute, namespaceUri: effectiveNamespace, elementRange: this.nodeToRange(node) }
                : {}),
            },
          }
          publish(elementSymbol, ownerName ? `${ownerName}\u0000${symbolName}` : symbolName)
          declaredNames.add(symbolName)
          // An `xsl:template name="X"` is the only thing a `calls` edge may name.
          if (declaration && effectiveNamespace === "http://www.w3.org/1999/XSL/Transform" && localName === "template") {
            declaredTemplateNames.add(symbolName)
          }
          // A MATCH-BASED `xsl:template`, collected for the `overrides` pass below.
          //
          // This is a separate condition from the one above on purpose. A template
          // carrying `match` and no `name` has `declaration === null`, so
          // `symbolName` falls back to the TAG name and every match-based template in
          // a stylesheet publishes the SAME symbol, `xsl:template`. That is correct
          // for containment and useless for identity: two templates that XSLT 1.0
          // §5.5 makes replace one another cannot be told apart if they share a name.
          //
          // Measured over the full 11,456-file admitted population, 3 sites in 3 files
          // declare two templates competing at the same match/mode/priority — e.g.
          // `libxslt/tests/docbook/fo/toc.xsl` lines 180 and 190, both
          // `<xsl:template match="*" mode="toc.for.section">`. §5.5: "It is an error if
          // a stylesheet contains more than one template with the same match and same
          // import precedence", and the later one is the one that runs. The lane had
          // RULED `overrides` inapplicable; the corpus overturned that ruling and
          // `script/m14/ontology-coverage-gate.ts` reports it FALSIFIED, so the type
          // is emitted rather than re-ruled.
          if (effectiveNamespace === "http://www.w3.org/1999/XSL/Transform" && localName === "template") {
            const matchAttr = this.findDirectAttribute(tagNode, "match")
            if (matchAttr) {
              const matchValue = this.attributeValueOf(tagNode, "match") ?? ""
              const modeValue = this.attributeValueOf(tagNode, "mode") ?? ""
              const priorityValue = this.attributeValueOf(tagNode, "priority") ?? ""
              // The identity XSLT 1.0 §5.5 compares is the (pattern, mode, priority)
              // triple, and it is the only identity a match-based template HAS.
              competingTemplates.push({
                key: `${matchValue}|${modeValue}|${priorityValue}`,
                declaredName: declaration ? symbolName : "",
                match: matchValue,
                mode: modeValue,
                priority: priorityValue,
                node,
                anchorNode: matchAttr,
                ownerName,
              })
            }
          }

          if (ownerName) {
            addRelationship(ownerName, symbolName, ASTEngine.RelationshipType.Contains, {
              role: "xml_element",
              ...(declaration ? { tagName: name, declarationKind: localName } : {}),
            // M60 requires the edge's line to be the line the TARGET NAME is
            // written on, and `addRelationship` already takes that node for
            // exactly this reason (M59.A7). This call site was passing the
            // ELEMENT, so a multi-line declaration pointed one line too high.
            }, declaration ? declaration.nameNode : node)
          }

          for (let i = 0; i < tagNode.namedChildCount; i++) {
            const child = tagNode.namedChild(i)
            if (!child || child.type !== "Attribute") continue
            this.extractAttribute(
              child,
              symbolName,
              symbols,
              addRelationship,
              publishedNames,
              declaredNames,
              namespaceBindings,
              referenceCandidates,
              ensureTargetSymbol,
              localName,
              effectiveNamespace,
              callCandidates,
              derivationCandidates,
              ownerName,
            )
          }

          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child && child !== tagNode) work.push({ node: child, ownerName: symbolName, dtdName, bindDepth: bindingScopes.length })
          }
          continue
        }
      }

      if (node.type === "doctypedecl") {
        const nameNode = this.findDirectChild(node, "Name")
        const positionedName = this.isPositionedDeclarationName(node, nameNode) ? nameNode!.text.trim() : undefined
        const currentDtdName = positionedName || dtdName
        if (positionedName) {
          publish(
            {
              name: positionedName,
              kind: ASTEngine.SymbolKind.Type,
              range: this.nodeToRange(node),
              visibility: "public",
              metadata: { nodeType: node.type, isDoctype: true, dtdName: positionedName },
            },
            positionedName,
          )
          declaredNames.add(positionedName)
        }

        const externalId = this.findDirectChild(node, "ExternalID")
        if (externalId && currentDtdName) {
          this.extractExternalId(externalId, currentDtdName, "doctype_external_id", addRelationship, imports)
        }

        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child && child !== nameNode && child !== externalId) work.push({ node: child, ownerName, dtdName: currentDtdName })
        }
        continue
      }

      if (node.type === "elementdecl") {
        const nameNode = this.findDirectChild(node, "Name")
        const name = nameNode?.text.trim()
        if (name) {
          publish(
            {
              name,
              kind: ASTEngine.SymbolKind.Type,
              range: this.nodeToRange(node),
              visibility: "public",
              ownerName: dtdName,
              ownerKind: dtdName ? ASTEngine.SymbolKind.Type : undefined,
              metadata: { nodeType: node.type, isDtdElementDeclaration: true, dtdName },
            },
            dtdName ? `${dtdName}\u0000${name}` : name,
          )
          declaredNames.add(name)
          if (dtdName) addRelationship(dtdName, name, ASTEngine.RelationshipType.Contains, { role: "dtd_element_declaration" }, nameNode)

          // The CONTENT MODEL. `<!ELEMENT a (b, (c|d)+)>` declares that `a`
          // admits `b`, `c` and `d`. Every one of those names is in the tree;
          // each gets a `contains` edge AND a symbol, so the edge resolves.
          const contentSpec = this.findDirectChild(node, "contentspec")
          if (contentSpec) {
            for (const member of this.descendantsOfType(contentSpec, "Name")) {
              const memberName = member.text.trim()
              if (!memberName) continue
              shadowCandidates.push({
                name: memberName,
                ownerName: dtdName,
                node: member,
                metadata: { isDtdContentModelMember: true, isDoctype: true, dtdName },
                edge: { source: name, role: "dtd_content_model", dtdName },
              })
            }
          }
        }
      }

      if (node.type === "AttlistDecl") {
        const elementName = this.findDirectChild(node, "Name")?.text.trim()
        if (elementName) {
          for (let i = 0; i < node.namedChildCount; i++) {
            const attDef = node.namedChild(i)
            if (!attDef || attDef.type !== "AttDef") continue
            const attrNameNode = this.findDirectChild(attDef, "Name")
            const attrName = attrNameNode?.text.trim()
            if (!attrName) continue
            const defaultDecl = this.findDirectChild(attDef, "DefaultDecl")
            const attrType = attDef.namedChildCount > 0
              ? this.findFirstNamedChild(attDef, new Set(["StringType", "TokenizedType", "Enumeration", "NotationType"]))
              : null
            publish(
              {
                name: attrName,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(attDef),
                visibility: "public",
                ownerName: elementName,
                ownerKind: ASTEngine.SymbolKind.Type,
                metadata: {
                  nodeType: "AttDef",
                  isDtdAttributeDeclaration: true,
                  dtdElement: elementName,
                  attributeType: attrType?.text,
                  defaultDeclaration: defaultDecl?.text,
                },
              },
              `${elementName}\u0000${attrName}`,
            )
            addRelationship(elementName, attrName, ASTEngine.RelationshipType.Contains, { role: "dtd_attribute_declaration" }, attrNameNode)

            // M18 (ATTLIST-default round): AN ATTRIBUTE'S DEFAULT IS A USE OF
            // WHATEVER IT IS BUILT FROM. `<!ATTLIST foo bar CDATA
            // "&lt;&gt;&quot;">>` says `bar`'s default value is assembled from
            // `lt`, `gt` and `quot`, and an attribute cannot be given its default
            // without expanding them. That claim was dropped: an `EntityRef` was
            // only collected under an OWNING ELEMENT, and a DTD declaration has no
            // element above it — the same structural reason the entity
            // replacement-text and parameter-reference rounds hit, and the third
            // instance of it.
            //
            // THE OWNER IS THE ATTRIBUTE, not the element the ATTLIST is about.
            // That is what makes the ruling derivable rather than a preference: the
            // default is a property of `bar`, so `bar` is what depends on `lt`, and
            // it is consistent with the `contains foo -> bar` edge this block
            // already publishes for the declaration itself. Attaching it to `foo`
            // instead would claim `foo` has a dependency its own declaration does
            // not mention.
            //
            // Measured by `script/m12/xml-entity-accounting.mts`, which is the
            // accounting that found it: 10 of the then-21-site residual, across 4
            // files. 9 are the PREDEFINED entities — the same `&lt; &gt; &quot;`
            // M18 made `builtin`, so these are resolvable, not dangling. The tenth
            // is libxml2's `test/errors/rec_att_default.xml`, where `&a;` expands
            // to `&b;` and `&b;` back to `&a;`; that file is an infinite-recursion
            // conformance probe, and publishing the reference is still correct —
            // the cycle is a property of the document, not a parse failure — so it
            // is labelled `recovery` rather than refused.
            if (defaultDecl) {
              const stack: Node[] = [defaultDecl]
              while (stack.length > 0) {
                const n = stack.pop()!
                if (n.type === "EntityRef") {
                  const text = n.text.trim()
                  if (text.length > 2 && text.startsWith("&") && text.endsWith(";")) {
                    const ref = text.slice(1, -1)
                    if (ref.length > 0) {
                      entityReferenceCandidates.push({ ownerName: attrName, name: ref, node: n, textNode: n })
                    }
                  }
                  continue
                }
                for (let i = n.namedChildCount - 1; i >= 0; i--) {
                  const c = n.namedChild(i)
                  if (c) stack.push(c)
                }
              }
            }

            // `<!ATTLIST gif src NOTATION (gif|jpg) #IMPLIED>` declares a
            // dependency on two NOTATIONS. Those names are declarations too.
            for (const notation of this.descendantsOfType(attDef, "NotationType")) {
              for (const notationName of this.descendantsOfType(notation, "Name")) {
                const target = notationName.text.trim()
                if (!target) continue
                shadowCandidates.push({
                  name: target,
                  ownerName: dtdName,
                  node: notationName,
                  metadata: { isDtdNotation: true, dtdName },
                  edge: { source: elementName, role: "dtd_notation_reference", dtdName },
                })
              }
            }
          }
        }
      }

      // ── entity and notation declarations ─────────────────────────────────────
      // `<!ENTITY e "v">`, `<!ENTITY % pe SYSTEM "common.dtd">` and
      // `<!NOTATION gif SYSTEM "image/gif">` are first-class DTD declarations,
      // and a parameter entity with an ExternalID is a real import of a file.
      if (node.type === "GEDecl" || node.type === "PEDecl" || node.type === "NotationDecl") {
        const nameNode = this.findDirectChild(node, "Name")
        const name = nameNode?.text.trim()
        const isParameter = node.type === "PEDecl"
        const isNotation = node.type === "NotationDecl"
        if (name) {
          // NOTE: an entity, a notation and an element may legitimately share a
          // name — libxml2's `id3.xml` has both `<!ELEMENT dest EMPTY>` and
          // `<!ENTITY dest SYSTEM "dtds/destfoo.ent">` — and BOTH are real
          // declarations, so this publishes unconditionally. The duplicate that
          // genuinely had to go was the SHADOW from `NDATA`/`NOTATION`, where the
          // same notation is named once as a declaration and once as a mention;
          // that is decided in the deferred shadow pass, which publishes only
          // when nothing else published the name.
          {
            publish(
              {
                name,
                kind: ASTEngine.SymbolKind.Type,
                range: this.nodeToRange(node),
                visibility: "public",
                ownerName: dtdName,
                ownerKind: dtdName ? ASTEngine.SymbolKind.Type : undefined,
                metadata: {
                  nodeType: node.type,
                  isDtdEntityDeclaration: true,
                  isDtdParameterEntity: isParameter,
                  isDtdNotationDeclaration: isNotation,
                  dtdName,
                },
              },
              dtdName ? `${dtdName}\u0000${name}` : name,
            )
          }
          declaredNames.add(name)
          if (dtdName) {
            addRelationship(dtdName, name, ASTEngine.RelationshipType.Contains, {
              role: isParameter ? "dtd_parameter_entity_declaration" : isNotation ? "dtd_notation_declaration" : "dtd_entity_declaration",
              dtdName,
            }, nameNode)
          }

          const externalId = this.findDirectChild(node, "ExternalID") || (isNotation ? this.findDirectChild(node, "PublicID") : null)
          if (externalId) {
            this.extractExternalId(
              externalId,
              name,
              isParameter ? "parameter_entity_external_id" : isNotation ? "notation_external_id" : "entity_external_id",
              addRelationship,
              imports,
            )
          }

          // `<!ENTITY logo SYSTEM "l.png" NDATA png>` points at a notation.
          const ndata = this.findDirectChild(node, "NDataDecl")
          const ndataName = ndata ? this.findDirectChild(ndata, "Name") : null
          if (ndataName) {
            const target = ndataName.text.trim()
            if (target) {
              shadowCandidates.push({
                name: target,
                ownerName: dtdName,
                node: ndataName,
                metadata: { isDtdNotation: true, dtdName },
                edge: { source: name, role: "dtd_ndata_notation", dtdName },
              })
            }
          }

          // M18 (accounting round): AN ENTITY'S REPLACEMENT TEXT IS ITS OWN
          // DOCUMENT. `<!ENTITY laugh1 "&laugh0;&laugh0;">` makes a real claim —
          // `laugh1` cannot be expanded without `laugh0` — and the claim was being
          // dropped, because an `EntityRef` was only collected when it sat under
          // an OWNING ELEMENT (`if (node.type === "EntityRef" && ownerName)`) and
          // the replacement text of a DTD declaration has no element above it.
          //
          // Found by `script/m12/xml-entity-accounting.mts`, the accounting check
          // that exists precisely because the collapse count and the site count
          // were never connected: 11,940 `EntityRef` sites, 11,289 accounted for,
          // and a **651-site shortfall concentrated in exactly this shape** — 611
          // of them (16 files) inside entity replacement text. libxml2's
          // `test/recurse/lol_ig_content.xml` is the extreme: 147 sites, 1 edge.
          //
          // The owner is the DECLARING ENTITY — not the DTD, and not an element —
          // because the dependency belongs to the entity: `laugh1` uses `laugh0`.
          // Collected here rather than left to the generic walk, which is correct
          // about what it sees and has no owner to give it in this position.
          // A parameter entity is excluded: `%pe;` in a replacement text is a
          // `PEReference`, a different construct with a different ruling, and
          // conflating the two would be the same defect one level down.
          // NOT restricted to general entities. The first version guarded this
          // with `!isParameter` to avoid conflating an `EntityRef` with a
          // `PEReference`, and the guard was over-broad: an `EntityRef` inside a
          // PARAMETER entity's replacement text is still an `EntityRef`, and it is
          // still a real reference from that entity — libxml2's `test/valid/t8a.xml`
          // writes `<!ENTITY % deftest '&lt;!ELEMENT test (#PCDATA) >'>`, whose
          // `&lt;` is a predefined reference the document genuinely makes. The
          // construct that needed separating is `%pe;`, which arrives as a
          // `PEReference` node and is not collected here at all.
          {
            const value = this.findDirectChild(node, "EntityValue")
            if (value) {
              const stack: Node[] = [value]
              while (stack.length > 0) {
                const n = stack.pop()!
                if (n.type === "EntityRef") {
                  const text = n.text.trim()
                  if (text.length > 2 && text.startsWith("&") && text.endsWith(";")) {
                    const ref = text.slice(1, -1)
// The name is a SUBSTRING OF A FILE ALREADY IN MEMORY, so it needs no length
                  // cap of its own: a cap here cannot bound anything the file size has
                  // not already bounded. The 256 that used to be here dropped legal
                  // names while the DECLARATION of the same name was published with no
                  // cap at all, so the graph carried `<!ENTITY very_long…>` as a symbol
                  // and none of its uses — libxml2's `result/bigentname.xml` names one
                  // 3,965 characters long, and both its uses vanished. A guard whose only
                  // effect is to disagree with the guard on the other side of the same
                  // fact is a defect, not a defence.
                  if (ref.length > 0) {
                      entityReferenceCandidates.push({ ownerName: name, name: ref, node: n, textNode: n })
                    }
                  }
                  continue
                }
                for (let i = n.namedChildCount - 1; i >= 0; i--) {
                  const c = n.namedChild(i)
                  if (c) stack.push(c)
                }
              }
            }
          }
        }
      }

      if (node.type === "PI") {
        const targetNode = this.findDirectChild(node, "PITarget")
        const target = targetNode?.text.trim()
        // `xml` is reserved: the grammar makes it an XMLDecl, and a PI target
        // that lower-cases to it is a declaration, not an instruction.
        if (target && target.toLowerCase() !== "xml") {
          publish(
            {
              name: target,
              kind: ASTEngine.SymbolKind.Module,
              range: this.nodeToRange(node),
              visibility: "public",
              ownerName,
              ownerKind: ownerName ? ASTEngine.SymbolKind.Class : undefined,
              metadata: { nodeType: node.type, isProcessingInstruction: true, target },
            },
            ownerName ? `${ownerName}\u0000${target}` : target,
          )
          if (ownerName) addRelationship(ownerName, target, ASTEngine.RelationshipType.Contains, { role: "processing_instruction" }, targetNode)
        }
      }

      // ── `<?xml-stylesheet …?>` and `<?xml-model …?>` ────────────────────────
      // The grammar's external scanner turns these into their own node types, so
      // the `PI` branch above never sees them. `href` on either is a FILE
      // reference: the XSLT / RelaxNG linkage between two files in a project.
      if (node.type === "StyleSheetPI" || node.type === "XmlModelPI") {
        const label = node.type === "StyleSheetPI" ? "xml-stylesheet" : "xml-model"
        publish(
          {
            name: label,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            visibility: "public",
            metadata: { nodeType: node.type, isProcessingInstruction: true, target: label, pseudoInstruction: true },
          },
          label,
        )
        for (let i = 0; i < node.namedChildCount; i++) {
          const pseudo = node.namedChild(i)
          if (!pseudo || pseudo.type !== "PseudoAtt") continue
          const pseudoNameNode = this.findDirectChild(pseudo, "Name")
          const valueNode = this.findDirectChild(pseudo, "PseudoAttValue")
          const attributeName = pseudoNameNode?.text.trim()
          if (!attributeName) continue
          const value = valueNode ? this.unquote(valueNode.text).trim() : undefined
          if (attributeName === "href" && value) {
            addRelationship(label, value, ASTEngine.RelationshipType.Imports, {
              role: "processing_instruction_href",
              attributeName,
            }, valueNode)
            imports.push({
              module: value,
              path: value,
              importType: "xml-stylesheet",
              range: this.nodeToRange(valueNode ?? pseudo),
              metadata: { instruction: label, attributeName },
            })
          } else {
            publish(
              {
                name: attributeName,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(pseudo),
                visibility: "public",
                ownerName: label,
                ownerKind: ASTEngine.SymbolKind.Module,
                metadata: { nodeType: pseudo.type, isPseudoAttribute: true, value },
              },
              `${label}\u0000${attributeName}`,
            )
            addRelationship(label, attributeName, ASTEngine.RelationshipType.Contains, { role: "pseudo_attribute" }, pseudoNameNode)
          }
        }
      }

      // M18: an entity USE in content. Collected, not decided — the declaration
      // may come later, and the DTD's own declarations are resolved in the
      // deferred pass with everything else.
      if (node.type === "EntityRef" && ownerName) {
        const text = node.text.trim()
        // `&name;` — the name is between the ampersand and the semicolon, and it
        // is written in the SOURCE, so the line below is the name's line and the
        // M60 rule is satisfied by construction rather than by a convention.
        if (text.length > 2 && text.startsWith("&") && text.endsWith(";")) {
          const name = text.slice(1, -1)
          // Same reasoning as the entity-replacement-text path: no length cap,
          // because the name is bounded by the file and the declaration side has
          // none either.
          if (name.length > 0) entityReferenceCandidates.push({ ownerName, name, node, textNode: node })
        }
      }

      // M18 (PEReference round): A PARAMETER ENTITY REFERENCE IS A USE, and the
      // 24 corpus sites are not a corner.
      //
      // `<!DOCTYPE root [ <!ENTITY % defroot '…'> %defroot; ]>` is how a DTD pulls
      // in another one: `%defroot;` expands, and the expansion's markup becomes part
      // of this DTD. That is the same fact `entity_external_id` already records for
      // `<!ENTITY % pe SYSTEM "common.dtd">`, reached by reference instead of by
      // ExternalID — and it was recorded only for the ExternalID form. So the graph
      // could say "this document imports common.dtd" and nothing at all about
      // `%defroot;`, which is the dependency the author actually wrote.
      //
      // The OWNER is the DOCTYPE's name, not an element: a parameter reference in
      // the internal subset has no element above it, exactly as an `EntityRef` in
      // replacement text had none. That was the X7 shape — a claim the document
      // makes, dropped because there was nothing obvious to attach it to — and it
      // is why these 24 sites produced no edge at all.
      //
      // The three shapes the corpus actually contains, and the ruling for each:
      //
      //   - 21 sites are a PEReference that is a DIRECT CHILD of `doctypedecl`.
      //     That position is precisely "the external subset is being pulled in
      //     here", so these are references and are published. Measured across
      //     t8/t8a/t9/t9a/index/huge/pe-latin1/lol_param/lol_ep and one
      //     PEDecl-nested case.
      //   - 1 site is `%global-attributes;` inside a `PEDecl`'s `EntityValue`: a
      //     parameter entity's replacement text invoking another. Also a real use,
      //     and the owner is the DECLARING ENTITY for the same reason an
      //     `EntityRef` in a `GEDecl`'s replacement text is.
      //   - 5 sites are under an `ERROR` root in libxml2's deliberately malformed
      //     corpus (`%xx;`, `% zz '&#60;`, `%a;`, `%elem;`, `%z;`). These are
      //     conformance probes for broken input, and the repair-labelling contract
      //     — `xml/recovery-labelling`, which pins that a symbol or edge from a
      //     damaged file is KEPT and LABELLED — is why they are not simply
      //     skipped. They are published with `recovery: true`, so a consumer can see
      //     a document asserted a dependency it never validly expressed.
      if (node.type === "PEReference") {
        const text = node.text.trim()
        if (text.length > 1 && text.startsWith("%")) {
          // `%name;` is a reference; `% name` followed by a quoted replacement is
          // the parameter-entity VALUE form and names nothing, which is why the
          // corpus contains both `%xx;` and `% zz '&#60;` and only the first is a
          // use. The semicolon is the discriminator, and requiring it is what stops
          // a literal `%` in replacement text becoming a name.
          //
          // MEASURED, not assumed — `validation/m14/fixtures/xml/pereference-shape-probe.mts`
          // runs three candidate predicates over every `PEReference` node it can
          // obtain and prints both verdicts per node. The two guards above are BOTH
          // load-bearing, which the prose here did not previously show:
          //
          //   shape                            semicolon  whitespace  published name
          //   `%pe;`  in an internal subset    yes        no         pe      <- the reference
          //   `% zz '&#60;`  (value form)      yes        YES        (none)  <- must stay dropped
          //   `%pe`   in <!ELEMENT %pe EMPTY>  NO         no         (none)  <- must stay dropped
          //
          // The third row is why the semicolon test cannot be relaxed: the grammar's
          // `PEReference` is `"%" Name ";"`, but on `<!ELEMENT %pe EMPTY>` — where the
          // semicolon is missing — error recovery still yields a `PEReference` node
          // whose single child is a `Name`. Reading that child publishes a use of `pe`
          // from a document that never wrote `%pe;`.
          //
          // So the whitespace question below stays a question about TEXT, and it is
          // the last thing in this analyzer that is. The reason is measured too: the
          // whitespace guard is only reachable on shapes where the recovered node's
          // structure does NOT decide the answer, which is exactly the case a
          // tree-walk cannot express. Read on 11 obtainable nodes (4 fixture, 7
          // synthetic, 0 corpus — see the probe's `corpus.counts`), replacing this
          // test with `Name`-child lookup disagreed on 3 and was wrong on 2 of them.
          const semi = text.indexOf(";")
          if (semi > 1) {
            const ref = text.slice(1, semi).trim()
            const isValueForm = ref.length === 0 || RealXmlAnalyzer.containsEcmaWhitespace(ref)
            // Is this reference inside an ENTITY'S REPLACEMENT TEXT? It has to be
            // answered by walking UP — the first version asked the `PEReference`
            // node for a direct `EntityValue` child, which a reference never has,
            // so the test was always false and every replacement-text reference
            // silently took the DOCTYPE as its owner. libxml2's
            // `result/valid/index.xml` has `%global-attributes;` inside a `PEDecl`
            // and was published as `NewsML -> global-attributes` when the owner
            // should be the entity that uses it.
            const inEntityValue = this.withinEntityValue(node)
            if (!isValueForm && ref.length > 0) {
              const ownerForRef = inEntityValue ? (this.enclosingDeclaredName(node) ?? dtdName ?? "") : (dtdName ?? "")
              if (ownerForRef.length > 0) {
                parameterEntityReferences.push({
                  ownerName: ownerForRef,
                  name: ref,
                  node,
                  textNode: node,
                  recovery: !!this.withinErrorRegion(node),
                })
              }
            }
          }
        }
      }

      const childDepth = bindDepth ?? 0
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) work.push({ node: child, ownerName, dtdName, bindDepth: childDepth })
      }
    }

    // ── the deferred shadow pass ─────────────────────────────────────────────
    // Every name in the document is known, so a shadow is published only when
    // nothing else published that name — the edge is still emitted either way,
    // because the DTD's own statement does not depend on whether the member was
    // separately declared.
    for (const candidate of shadowCandidates) {
      ensureTargetSymbol(candidate.name, candidate.ownerName, ASTEngine.SymbolKind.Type, candidate.node, candidate.metadata)
      addRelationship(candidate.edge.source, candidate.name, ASTEngine.RelationshipType.Contains, {
        role: candidate.edge.role,
        dtdName: candidate.edge.dtdName,
      }, candidate.node)
    }

    // ── which namespaces does this document IMPORT? ───────────────────────────
    // A separate pass rather than a hook in the element branch, because the
    // import may be declared AFTER the reference that needs it: a schema that
    // references `pic:pic` on line 56 and imports that namespace on line 41 is
    // the ordinary spelling, and resolving on the spot would drop it — the same
    // forward-reference trap the candidate queue exists to avoid, one level up.
    {
      const IMPORT_ELEMENTS = new Set(["import", "include", "import-schema"])
      const stack: Node[] = [rootNode]
      while (stack.length) {
        const n = stack.pop()!
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c) stack.push(c)
        }
        if (n.type !== "element") continue
        const tag = n.children.find((c) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
        if (!tag) continue
        const local = this.findDirectChild(tag, "Name")?.text.trim().split(":").pop() ?? ""
        if (!IMPORT_ELEMENTS.has(local)) continue
        let nsUri: string | undefined
        let path: string | undefined
        for (let i = 0; i < tag.namedChildCount; i++) {
          const attr = tag.namedChild(i)
          if (attr?.type !== "Attribute") continue
          const an = this.findDirectChild(attr, "Name")?.text.trim()
          const av = this.findDirectChild(attr, "AttValue")
          const value = av ? this.unquote(av.text).trim() : undefined
          if (!an || value === undefined) continue
          if (an === "namespace") nsUri = value
          // `schemaLocation` is a namespace/URI PAIR LIST; the URIs are the
          // paths, and the odd-indexed tokens are the ones that are files.
          else if (an === "schemaLocation") {
            const parts = RealXmlAnalyzer.splitOnWhitespace(value)
            path = parts.length % 2 === 0 ? parts[parts.length - 1] : parts[0]
          } else if (an === "href") path = value
        }
        if (nsUri) importedNamespaces.set(nsUri, { path, element: local })
      }
    }

    // ── the deferred reference pass ───────────────────────────────────────────
    // Every name in the document is now known, so every candidate can be
    // decided. A value that names nothing this document declares and is not a
    // known built-in is REFUSED: recording it would put a name in the graph that
    // no file in the corpus supports, which is the M60.R10 "a value where a name
    // belongs" class of lie.
    for (const candidate of referenceCandidates) {
      if (candidate.bareNameReference) {
        // A named-template call names a declaration in THIS document; if the
        // document does not declare it, the edge would point at nothing, so it is
        // refused exactly like an unresolved QName.
        if (!declaredNames.has(candidate.value)) continue
        addRelationship(candidate.ownerName, candidate.value, ASTEngine.RelationshipType.References, {
          role: "xslt_named_template_reference",
          attributeName: candidate.attributeName,
          resolvable: "in-document",
        }, candidate.valueNode)
        continue
      }
      const qname = this.asQName(candidate.value)
      if (!qname) continue
      const resolvableInDocument = declaredNames.has(qname.local)
      // A BUILT-IN is reached ONE way: the value carries a PREFIX whose binding is
      // a built-in namespace. `xs:int` and `xml:lang` are recognised.
      //
      // There is a second way — a BARE value names a built-in when the element
      // carrying it is in the XSD namespace, so `<xsd:element type="int"/>` reads
      // as the built-in `int` in a document written `xmlns="…/2001/XMLSchema"`
      // with no prefix at all, which is the older and very common spelling. It is
      // NOT implemented, and implementing it would be a DEFECT rather than a fix.
      //
      // `libxml2/test/schemas/vdv-first5_0.xsd` writes
      //
      //     <xs:schema xmlns:xs="…/2001/XMLSchema">
      //       <xs:include schemaLocation="vdv-simpleTypes.xsd"/>
      //       <xs:element name="born" type="date"/>
      //
      // and `vdv-simpleTypes.xsd` line 32 declares a CUSTOM type called `date`.
      // So that bare `date` is the schema's own type, not XSD's built-in `date` —
      // and both files are libxml2's own schema-composition tests, so the intent
      // is not in doubt. Resolving it as a built-in would replace a correct
      // refusal with a confidently wrong answer, and the corpus differential
      // reported it as a MISS precisely because its oracle made the same unsafe
      // inference and disagreed with a refusal that was right.
      //
      // Telling the two apart needs `xs:include` cross-file declarations, which is
      // the same machinery X7 started for `import` and has not been built for
      // `include` — and `include` is harder, because an included schema shares the
      // INCLUDING schema's target namespace, so a bare name may be satisfied by
      // either file and the disambiguation is a whole-corpus question rather than
      // a per-document one. Until that exists, refusing a bare value that no file
      // in this document declares is the honest reading, and the corpus sites are
      // recorded rather than papered over.
      const isBuiltin = candidate.binding !== undefined && RealXmlAnalyzer.BUILTIN_NAMESPACE_URIS.has(candidate.binding)
      // X7: an IMPORTED namespace makes the name resolvable in a third way. The
      // target symbol is deliberately NOT published — the component is not in
      // this file, and a phantom local symbol is exactly the R10 lie — but the
      // EDGE is, carrying the file it lives in.
      const imported = !resolvableInDocument && !isBuiltin && candidate.binding !== undefined
        ? importedNamespaces.get(candidate.binding)
        : undefined
      // X13: a BARE value, on an attribute that carries a reference, whose OWNER
      // is in a declaration vocabulary, and which this document does not declare.
      //
      // The reference is REAL — the document says this element's type is that
      // name — and it was being DROPPED, which is the same defect the review has
      // been closing all along: a claim the graph cannot see. Two real cases in
      // the corpus, and they are indistinguishable from one file:
      //
      //   cxf/…/calculator.xsd            `xmlns="…XMLSchema"`, `type="int"`
      //     -> the XSD built-in
      //   libxml2/…/vdv-first5_0.xsd     `xs:include`es vdv-simpleTypes.xsd,
      //     `type="date"`                   which declares its OWN `date` at
      //                                        line 32
      //
      // One is a built-in, one is an included custom type, and from inside this
      // file they are the same three characters. Resolving either by rule is a
      // guess: the bare-built-in rule makes the second confidently WRONG, and the
      // refusal makes the first unresolvable for no stated reason.
      //
      // So the claim is EMITTED, with a fourth resolvability class:
      //
      //   in-document  declared here
      //   builtin      an XML/XSD built-in
      //   external     declared in a file this document imports, with the file
      //   unresolved   a real reference this file does not satisfy  <- X13
      //
      // and `ambiguousWithBuiltin` is set when the name is ALSO a built-in, which
      // is precisely the case where a consumer must not guess either way. The
      // target symbol is still not published — the component is not in this file —
      // so this adds an EDGE, never a phantom declaration.
      //
      // Restricted to a BARE value under a vocabulary owner. A PREFIXED value
      // bound to a namespace this document neither declares nor imports is still
      // REFUSED: there is no document anywhere that supports the name, and
      // `xml/xsd-external-reference` pins that. Resolving includes for real needs
      // the include GRAPH, which a per-file analyzer cannot see and which belongs
      // to a project-level pass rather than here — that is a feature, not a gap
      // in this function, and naming it as one would be a way of not doing it.
      const ownerIsVocabulary = candidate.ownerNs !== undefined
        && RealXmlAnalyzer.DECLARATION_VOCABULARIES[candidate.ownerNs] !== undefined
      // "BARE" means the value carries NO PREFIX — tested on the PREFIX, not on
      // `binding === undefined`. Those are not the same predicate: a PREFIXED
      // value whose prefix is bound nowhere also has no binding, and using the
      // proxy classified `type="xsd:int"` in cxf's calculator.xsd as an unresolved
      // BARE reference to the built-in `int` when `xsd` is bound to the XSD
      // namespace and the answer is plainly `builtin`. This is the same
      // conflation that made the corpus oracle's bare-built-in test wrong — it
      // asked whether the VALUE had a namespace instead of whether it had a
      // prefix — and it is worth stating that the mistake survived being spotted
      // once, in a different file, on the same question.
      const isBareValue = qname.prefix.length === 0
      const unresolvedBareReference = !resolvableInDocument && !isBuiltin && !imported
        && isBareValue
        && ownerIsVocabulary
      if (!resolvableInDocument && !isBuiltin && !imported && !unresolvedBareReference) continue
      const ambiguousWithBuiltin = unresolvedBareReference
        && RealXmlAnalyzer.XSD_BUILTIN_TYPE_NAMES.has(qname.local)
      if (resolvableInDocument) {
        ensureTargetSymbol(qname.local, undefined, ASTEngine.SymbolKind.Type, candidate.nameNode, { isReferencedDeclaration: true })
      }
      addRelationship(candidate.ownerName, qname.local, ASTEngine.RelationshipType.References, {
        role: "attribute_qname_reference",
        attributeName: candidate.attributeName,
        qname: candidate.value,
        prefix: qname.prefix,
        namespaceUri: candidate.binding,
        resolvable: isBuiltin ? "builtin" : resolvableInDocument ? "in-document" : unresolvedBareReference ? "unresolved" : "external",
        // X13: the name is also a built-in, and this file cannot say whether the
        // document means the built-in or a same-named type an `xs:include` brought
        // in. Recorded so a consumer can see the ambiguity instead of inheriting
        // whichever reading the graph happened to take.
        ...(ambiguousWithBuiltin ? { ambiguousWithBuiltin: true } : {}),
        // where the name actually lives, so a consumer can follow it rather than
        // having to guess from the namespace alone
        ...(imported ? { importedFrom: imported.path, importedBy: imported.element } : {}),
      }, candidate.valueNode)
    }

    // ── named-template CALLS (XSLT 1.0 §6) ────────────────────────────────────
    //
    // `xsl:call-template name="render"` INVOKES the template `render`. The edge is
    // written only when this stylesheet declares a template of that name, and the
    // test is `declaredTemplateNames` rather than `declaredNames` so that a shadow
    // symbol invented for some reference cannot become the target of a call.
    //
    // The 724 libxslt sites whose target is NOT declared in the same file are
    // REFUSED rather than emitted as dangling, and the refusal is a real boundary
    // rather than a gap: the template is declared in an INCLUDED or IMPORTED
    // stylesheet, which a per-file analyzer cannot read. `xsl:import`/`xsl:include`
    // sites are counted and reported as declared debt (see
    // `docs/analyzers/real-xml-analyzer.md`, limitations), so the missing half of
    // the call graph is a number in this repository and not a silence.
    for (const cand of callCandidates) {
      if (!declaredTemplateNames.has(cand.templateName)) continue
      // NO self-edge guard here, and its absence is a finding rather than an
      // oversight. The reference pass refuses a construct that references itself,
      // and the obvious move was to copy that guard — which would have dropped
      // RECURSION, because a template invoking itself is ordinary XSLT:
      // `libxslt/tests/XSLTMark/bottles.xsl` calls `bottles` from inside `bottles`
      // three times in one template. XSLT 1.0 §6 makes TWO TEMPLATES of one name and
      // import precedence the error, not a template calling one of them, so
      // `calls countdown -> countdown` is a true edge and is published.
      addRelationship(cand.ownerName, cand.templateName, ASTEngine.RelationshipType.Calls, {
        role: "xslt_named_template_call",
        attributeName: "name",
        templateName: cand.templateName,
        // A name resolved against the stylesheet's own declarations, which is what
        // makes this edge different from a mention. XSLT 2.0 §6.1.3 adds
        // `xsl:use-when`/`use-unless` to conditional dispatch, and neither can change
        // WHICH template is invoked.
        resolvable: "in-document",
      }, cand.textNode)
    }

    // ── COMPETING TEMPLATE RULES (XSLT 1.0 §5.5) ────────────────────────────
    //
    // Two `xsl:template` declarations in one stylesheet with the same `match`, `mode`
    // and `priority` are an ERROR in XSLT 1.0 §5.5 — "It is an error if a stylesheet
    // contains more than one template with the same match and same import precedence"
    // — and the processor resolves it by running the LATER one. That is an override in
    // the only sense this language has one, and it is what this lane's `overrides`
    // verdict now records.
    //
    // WHY THIS IS A GAP AND NOT A RULED TYPE: the lane ruled `overrides` inapplicable
    // on a parse-tree count, and `script/m14/ontology-coverage-gate.ts` reported that
    // ruling FALSIFIED over the full 11,456-file admitted population — 3 sites in 3
    // files. The first counter-example found was `libxslt/tests/docbook/fo/toc.xsl`,
    // which declares `<xsl:template match="*" mode="toc.for.section">` at line 180 and
    // again at line 190. The gate exists because a differential cannot catch this: the
    // oracle omitted the type for the same reason the analyzer did, so nothing
    // disagreed with anything.
    //
    // DIRECTION: source is the template that WINS (the later declaration), target is
    // the one it REPLACES. So the edge answers "what silently took this rule's place",
    // which is the question a reader of a stylesheet with a duplicated rule has.
    //
    // THE ENDPOINT NAMES, and why they are safe. A match-based template has no `name`,
    // so this analyzer gives it the TAG name `xsl:template` — and then every
    // match-based template in the file is the same symbol, which is why this could not
    // be emitted before. A colliding template therefore publishes a DERIVED identity
    // built from the very triple §5.5 compares: `match=<pattern>|mode=<mode>|priority=
    // <priority>`. Two properties make that safe rather than inventive:
    //
    //   1. It is DISJOINT from every name a document can declare. `|`, `=`, `<` and `>`
    //    are not NCName characters (XML 1.0 §2.3: NameChar excludes all four), so no
    //    `xsl:template name="…"` and no declared name in any vocabulary can equal it.
    //    A derived identity can therefore never shadow, merge with or be mistaken for a
    //    real name — it can only ever be its own thing.
    //   2. It is published ONLY for templates that actually collide. 3 sites in 11,456
    //    files, so the symbol table gains a handful of clearly-marked rows rather than
    //    one per match-based template in the corpus.
    //
    // A template that DOES carry a `name` is published under that name, which is the
    // better endpoint and is preferred; the derived identity is a fallback for the
    // nameless case only.
    {
      const byKey = new Map<string, typeof competingTemplates>()
      for (const t of competingTemplates) {
        const arr = byKey.get(t.key) ?? []
        arr.push(t)
        byKey.set(t.key, arr)
      }
      for (const group of byKey.values()) {
        if (group.length < 2) continue
        // Do the members have DISTINCT declared names? If so those names are the better
        // endpoints — they are written in the document. If they share one name, or have
        // none, the declared name cannot separate the two declarations at all: two
        // templates of one name ARE one name as far as the store is concerned, and an
        // `overrides first -> first` self-edge carries no information a reader can use.
        const declared = group.map((t) => t.declaredName)
        const useDeclaredNames = declared.every((d) => d.length > 0) && new Set(declared).size === declared.length
        // Document order is the order §5.5 resolves in, and `competingTemplates` is
        // filled by a walk that visits elements in document order, so index N of a group
        // is a stable property of the declaration rather than of the parse.
        const identityOf = (t: (typeof group)[number], index: number): string => {
          if (useDeclaredNames) return t.declaredName
          const derived = `xsl:template[match=${t.match}|mode=${t.mode}|priority=${t.priority}]#${index}`
          ensureTargetSymbol(derived, t.ownerName, ASTEngine.SymbolKind.Class, t.anchorNode, {
            nodeType: "element",
            tagName: "xsl:template",
            isXmlElement: true,
            // Marked, so a consumer can tell a derived identity from a declared one
            // instead of inferring it from the punctuation.
            derivedTemplateIdentity: true,
            // The `name` attribute is carried here because a colliding pair usually
            // shares one, or has none: dropping it would lose the only name the
            // document actually wrote.
            ...(t.declaredName.length > 0 ? { declaredName: t.declaredName } : {}),
            templateMatch: t.match,
            templateMode: t.mode,
            templatePriority: t.priority,
            templateOccurrenceInGroup: index,
          })
          return derived
        }
        const identities = group.map(identityOf)
        for (let i = 1; i < group.length; i++) {
          const winner = group[i]
          const source = identities[i]
          const target = identities[i - 1]
          if (source.length === 0 || target.length === 0 || source === target) continue
          addRelationship(source, target, ASTEngine.RelationshipType.Overrides, {
            role: "xslt_competing_template_rule",
            // The three attributes §5.5 compares, carried so a consumer can re-derive
            // the collision instead of trusting the edge.
            templateMatch: winner.match,
            templateMode: winner.mode,
            templatePriority: winner.priority,
            derivation: "xslt-5.5-later-template-replaces-earlier",
            resolvable: "in-document",
            ...(winner.declaredName.length > 0 ? { declaredName: winner.declaredName } : {}),
          }, winner.anchorNode)
        }
      }
    }

    // ── XSD TYPE DERIVATION (XSD 1.0 §3.4.2) ─────────────────────────────────
    //
    // The four resolvability classes are the reference pass's, unchanged, because
    // this IS the reference pass's decision with a more precise label: a derived
    // type and its base stand in the relation `extends` names, and the question of
    // whether the base can be resolved is the same question asked of `type=`.
    for (const cand of derivationCandidates) {
      const qname = this.asQName(cand.value)
      if (!qname) continue
      const resolvableInDocument = declaredNames.has(qname.local)
      const isBuiltin = cand.binding !== undefined && RealXmlAnalyzer.BUILTIN_NAMESPACE_URIS.has(cand.binding)
      const imported = !resolvableInDocument && !isBuiltin && cand.binding !== undefined
        ? importedNamespaces.get(cand.binding)
        : undefined
      const ownerIsVocabulary = cand.ownerNs !== undefined
        && RealXmlAnalyzer.DECLARATION_VOCABULARIES[cand.ownerNs] !== undefined
      const isBareValue = qname.prefix.length === 0
      const unresolvedBare = !resolvableInDocument && !isBuiltin && !imported && isBareValue && ownerIsVocabulary
      if (!resolvableInDocument && !isBuiltin && !imported && !unresolvedBare) continue
      // No self-edge guard, because for this edge one could not fire: the owner of a
      // `base=` attribute is the anonymous `xs:extension`/`xs:restriction` element,
      // never the derived type's name, so `ownerName === qname.local` is
      // unreachable. A guard written to look like an invariant and be unreachable is
      // the defect class `xml/dtd-declarations` was written to catch.
      if (resolvableInDocument) {
        ensureTargetSymbol(qname.local, undefined, ASTEngine.SymbolKind.Type, cand.nameNode, { isReferencedDeclaration: true })
      }
      addRelationship(cand.ownerName, qname.local, ASTEngine.RelationshipType.Extends, {
        role: "xsd_derivation_base",
        attributeName: "base",
        qname: cand.value,
        prefix: qname.prefix,
        namespaceUri: cand.binding,
        // WHICH derivation, because XSD has two and they narrow in opposite
        // directions: `extension` keeps everything the base admits and adds to it,
        // `restriction` admits a subset. The edge is the same subtype relation in
        // both cases and this is what tells a consumer which way.
        derivation: cand.kind,
        resolvable: isBuiltin ? "builtin" : resolvableInDocument ? "in-document" : unresolvedBare ? "unresolved" : "external",
        ...(unresolvedBare && RealXmlAnalyzer.XSD_BUILTIN_TYPE_NAMES.has(qname.local) ? { ambiguousWithBuiltin: true } : {}),
        ...(imported ? { importedFrom: imported.path, importedBy: imported.element } : {}),
      }, cand.valueNode)
    }

    // ── entity uses, decided now that every declaration is known ─────────────
    for (const cand of entityReferenceCandidates) {
      const declared = declaredNames.has(cand.name)
      // THE FIVE PREDEFINED ENTITIES ARE BUILTIN, and getting this wrong is a
      // false claim about the document rather than a missed edge.
      //
      // `&lt; &gt; &amp; &apos; &quot;` are declared by the XML specification
      // itself, in every document, whether or not a DTD says so — the same
      // argument X8 settled for the `xml` and `xmlns` namespace prefixes. The
      // grammar hands them over as `EntityRef` nodes, and this pass had exactly
      // two answers, `declared` or nothing, so all of them took the second and were
      // stamped `resolvable: "unresolved"` with `danglingEntityReference: true`:
      // the analyzer asserting that a document references an entity nothing
      // defines, for text that is well-formed in every conforming parser.
      //
      // Measured by `script/m12/xml-entity-accounting.mts`: **4,575 sites across
      // 180 files** name one of the five — 2,175 `&lt;`, 1,683 `&gt;`, 426
      // `&amp;`, 160 `&quot;`, 131 `&apos;`. `&d;` (4,370) and `&nbsp;` (1,381)
      // are NOT predefined and stay unresolved unless the document declares them,
      // which is the correct reading: an undeclared HTML entity in an XML document
      // really is undefined.
      const builtin = RealXmlAnalyzer.PREDEFINED_ENTITIES.has(cand.name)
      // Dangling uses are RECORDED, not refused: `&undefined;` is a claim the
      // document makes about itself, and refusing it is what made 4,423 of them
      // invisible. Same ruling as X13's `unresolved` class, for the same reason,
      // and the target symbol is still not published — a use is not a declaration.
      addRelationship(cand.ownerName, cand.name, ASTEngine.RelationshipType.References, {
        role: "entity_reference",
        entityName: cand.name,
        resolvable: declared ? "in-document" : builtin ? "builtin" : "unresolved",
        ...(declared || builtin ? {} : { danglingEntityReference: true }),
      }, cand.textNode)
    }

    // ── parameter entity references, decided now that every declaration is known ──
    //
    // A parameter entity has no builtin form — there is no `%lt;` — so the answer
    // is binary: the document's own DTD declares it, or nothing does. There is no
    // third class here, which is the difference from `EntityRef` and worth stating
    // because the shape of the code invites copying it.
    for (const cand of parameterEntityReferences) {
      const declared = declaredNames.has(cand.name)
      addRelationship(cand.ownerName, cand.name, ASTEngine.RelationshipType.References, {
        role: "parameter_entity_reference",
        entityName: cand.name,
        isParameterEntity: true,
        resolvable: declared ? "in-document" : "unresolved",
        // Kept and LABELLED rather than dropped, which is the recovery-labelling
        // contract `xml/recovery-labelling` already pins for symbols and edges out
        // of a damaged file. libxml2's `test/errors/*` is a corpus of deliberately
        // malformed documents; a parameter reference recovered out of one is a claim
        // the bytes make that no processor would honour, and saying so is more
        // useful than silence.
        ...(cand.recovery ? { recovery: true, reasonCode: "parameter-entity-reference-in-damaged-region" } : {}),
        ...(declared ? {} : { danglingEntityReference: true }),
      }, cand.textNode)
    }

    const hasSyntaxErrors = errorNodes > 0 || missingNodes > 0
    if (hasSyntaxErrors) {
      // Deliberately NOT suppressed: a 90 %-parseable vendor file must stay
      // visible, and the errors are already reported by the engine. But every
      // symbol and edge from such a file now says so, so nothing downstream can
      // present a recovery-shaped reading as a clean one.
      for (const symbol of symbols) symbol.metadata.syntaxErrors = true
      for (const relationship of relationships) relationship.metadata.syntaxErrors = true
    }

    // ── the placeholder-literal refusal (M60 rule R7) ─────────────────────────
    //
    // `unknown` is the project's placeholder for "this endpoint could not be
    // determined", and rule R7 says no edge endpoint may equal it — a consumer
    // reading the string cannot tell a placeholder from a name.
    //
    // The census found the collision in real code, not in theory:
    // `libxslt/tests/general/bug-166.xsl` lines 28-40 build two `xsl:variable`
    // result-tree fragments out of literal result elements, and the first element
    // in BOTH is literally `<unknown/>`. So the analyzer published a symbol named
    // `unknown` and two edges `contains type-sort-order -> unknown` and
    // `contains attribute-sort-order -> unknown` — 2 of the 191,251 relationship
    // endpoints the census resolved, and the only 2 that collided.
    //
    // REFUSED, and the refusal costs 2 symbols and 2 edges in 1 file of 11,066.
    // The alternative is a graph in which `unknown` is both a real component and
    // the absence of one, and no consumer can be told which it is reading — which
    // is the same ruling the lane already applied to a symbol named "" (`xmlns:`
    // with an empty prefix), for the same reason.
    //
    // Placed at ONE choke point rather than at each publish site, because the
    // collision can arrive from any of them — an element tag, an attribute name, a
    // DTD entity name, a notation name, a content-model member — and a guard that
    // is added per site is a guard that will eventually be missed at one of them.
    {
      const isPlaceholder = (name: string) => name === RealXmlAnalyzer.PLACEHOLDER_LITERAL
      const keptSymbols = symbols.filter((s) => !isPlaceholder(String(s.name ?? "")))
      const keptRelationships = relationships.filter((x) => !isPlaceholder(String(x.source ?? "")) && !isPlaceholder(String(x.target ?? "")))
      const droppedSymbols = symbols.length - keptSymbols.length
      const droppedRelationships = relationships.length - keptRelationships.length
      if (droppedSymbols > 0 || droppedRelationships > 0) {
        return {
          language: "xml",
          symbols: keptSymbols,
          relationships: keptRelationships,
          imports,
          exports: [],
          errors,
          metadata: {
            complexity: keptSymbols.length + keptRelationships.length,
            linesOfCode: content.split("\n").length,
            cyclomaticComplexity: 1,
            patterns: [],
            framework: "XML",
            errorNodes,
            missingNodes,
            syntaxErrors: hasSyntaxErrors,
            placeholderLiteralRefusals: droppedSymbols + droppedRelationships,
          },
        }
      }
    }

    return {
      language: "xml",
      symbols,
      relationships,
      imports,
      exports: [],
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1,
        patterns: [],
        framework: "XML",
        errorNodes,
        missingNodes,
        syntaxErrors: hasSyntaxErrors,
      },
    }
  }

  /**
   * `<!DOCTYPE a PUBLIC "-//X//DTD A//EN" "a.dtd">` spans lines: `PUBLIC` and the
   * public id are on one, the SYSTEM path on another. The edge target is the
   * path, so the edge's line is the LITERAL's line (M59.A7 / #825) — passing the
   * `ExternalID` node instead points the edge at the `SYSTEM` keyword's line,
   * which is the line of no name in the edge.
   */
  private extractExternalId(
    externalId: Node,
    owner: string,
    role: string,
    addRelationship: (source: string, target: string, type: ASTEngine.RelationshipType, metadata: Record<string, any>, node?: Node | null) => void,
    imports: ASTEngine.ImportInfo[],
  ): void {
    const systemLiteral = this.findDirectChild(externalId, "SystemLiteral")
    const pubidLiteral = this.findDirectChild(externalId, "PubidLiteral")
    const literal = systemLiteral || pubidLiteral
    if (!literal) return
    const path = this.unquote(literal.text)
    if (!path) return
    imports.push({
      module: path,
      path,
      importType: "xml-doctype",
      range: this.nodeToRange(literal),
      metadata: { isDtdExternalId: true, role, systemId: Boolean(systemLiteral) },
    })
    addRelationship(owner, path, ASTEngine.RelationshipType.Imports, {
      role,
      externalIdKind: systemLiteral ? "system" : "public",
    }, literal)
  }

  /**
   * A correctly-parsed declaration's name is its FIRST named child. If it is
   * not, the node is a recovery shape and any `Name` beneath it may be a
   * fragment of a construct the parser did not understand — publishing it would
   * put a name in the graph that is not a declaration. The pre-repair grammar
   * produced exactly this for a conditional section: the DTD's name came out as
   * the literal text `INCLUDE`.
   */
  private isPositionedDeclarationName(node: Node, nameNode: Node | null): boolean {
    if (!nameNode) return false
    const firstNamed = node.namedChild(0)
    return Boolean(firstNamed) && firstNamed!.id === nameNode.id
  }

  /** Reads the `xmlns` / `xmlns:prefix` attributes of a tag into the binding map. */
  private rememberNamespaces(tagNode: Node, bindings: Map<string, string>): void {
    for (let i = 0; i < tagNode.namedChildCount; i++) {
      const child = tagNode.namedChild(i)
      if (!child || child.type !== "Attribute") continue
      const attributeName = this.findDirectChild(child, "Name")?.text.trim()
      if (attributeName !== "xmlns" && !attributeName?.startsWith("xmlns:")) continue
      const valueNode = this.findDirectChild(child, "AttValue")
      if (!valueNode) continue
      const prefix = attributeName === "xmlns" ? "" : attributeName!.slice(6)
      if (attributeName !== "xmlns" && prefix.length === 0) continue
      bindings.set(prefix, this.unquote(valueNode.text))
    }
  }

  private extractAttribute(
    node: Node,
    ownerName: string,
    symbols: ASTEngine.UniversalSymbol[],
    addRelationship: (source: string, target: string, type: ASTEngine.RelationshipType, metadata: Record<string, any>, node?: Node | null) => void,
    publishedNames: Set<string>,
    declaredNames: Set<string>,
    namespaceBindings: Map<string, string>,
    referenceCandidates: { ownerName: string; attributeName: string; value: string; nameNode: Node; valueNode: Node; binding: string | undefined; ownerNs?: string; bareNameReference?: boolean }[],
    ensureTargetSymbol: (
      name: string,
      ownerName: string | undefined,
      kind: ASTEngine.SymbolKind,
      node: Node | null,
      metadata: Record<string, any>,
    ) => string,
    ownerLocalName: string,
    ownerNamespace: string | undefined,
    // The two ontology queues this method feeds: XSLT named-template CALLS and XSD
    // type DERIVATION. Both are collected here and decided after the walk, because
    // both name a declaration that is usually declared later in the file.
    callCandidates: { ownerName: string; templateName: string; valueNode: Node; textNode: Node }[],
    derivationCandidates: {
      ownerName: string
      value: string
      binding: string | undefined
      ownerNs: string | undefined
      kind: "extension" | "restriction"
      valueNode: Node
      nameNode: Node
    }[],
    /**
     * The OWNER OF THE ELEMENT CARRYING THE ATTRIBUTE — one level further out than
     * `ownerName`, which is the element's OWN symbol.
     *
     * It exists for one edge. A `calls` edge is caller-to-callee in every other
     * analyzer, and the caller of `<xsl:call-template name="x"/>` is the enclosing
     * template, not the instruction: `extractAttribute` is handed the instruction's
     * own symbol, so using `ownerName` produced `calls xsl:call-template -> inner`,
     * which names a call SITE and loses which template made the call. In a stylesheet
     * with forty call instructions the source would be one name forty times over.
     */
    elementOwnerName: string | undefined,
  ): void {
    // The OWNER's resolved namespace, carried on every reference candidate. X11:
    // a BARE value names a built-in type only when the element carrying it is
    // itself in the XSD namespace, because that is what makes an unprefixed
    // QName resolve into it. The value's own binding cannot answer that — a bare
    // value has none — so the question has to travel with the candidate.
    const ownerNs = ownerNamespace
    // Is this element one that NAMES another declaration rather than being one?
    // `name` is the attribute in both cases, and the two readings are opposites,
    // so the vocabulary — not the attribute name — decides which applies.
    const namedRefs = ownerNamespace ? RealXmlAnalyzer.NAMED_REFERENCE_ELEMENTS[ownerNamespace] : undefined
    this.bareNameReference = namedRefs ? namedRefs.has(ownerLocalName) : false
    // `xsl:call-template` names a template it INVOKES (XSLT 1.0 §6), which is a
    // `calls` edge. The predicate is the vocabulary's, not the attribute's, for the
    // reason NAMED_REFERENCE_ELEMENTS states: `name` is a declaration on every
    // sibling construct and a call target on this one.
    this.xsltCallElement =
      ownerNamespace === "http://www.w3.org/1999/XSL/Transform" && RealXmlAnalyzer.XSLT_CALL_ELEMENTS.has(ownerLocalName)
    // `base` on an XSD `extension`/`restriction` is type DERIVATION (§3.4.2), not a
    // reference. Read here, at the only place that knows the element's namespace
    // and local name together.
    this.xsdDerivationElement =
      ownerNamespace === "http://www.w3.org/2001/XMLSchema"
      && (ownerLocalName === "extension" || ownerLocalName === "restriction")
    this.derivationKind = ownerLocalName === "extension" ? "extension" : "restriction"
    this.bareNameDeclarationElement =
      ownerNamespace === "http://relaxng.org/ns/structure/1.0"
      && (ownerLocalName === "element" || ownerLocalName === "attribute" || ownerLocalName === "define")
    const nameNode = this.findDirectChild(node, "Name")
    const valueNode = this.findDirectChild(node, "AttValue")
    const attributeName = nameNode?.text.trim()
    if (!attributeName) return

    const value = valueNode ? this.unquote(valueNode.text) : undefined
    const isNamespace = attributeName === "xmlns" || attributeName.startsWith("xmlns:")
    const namespacePrefix = attributeName === "xmlns" ? "default" : attributeName.slice("xmlns:".length)
    // `xmlns:` with an EMPTY prefix is not well-formed XML, but the grammar
    // accepts it and the attribute name is read from the tree, so the branch is
    // reached. Publishing it would put a symbol named "" in the graph — the one
    // name that is guaranteed to collide with every other and to match no
    // search. Measured on libxml2's `err_1.xml` and two libxslt fixtures.
    if (!attributeName) return
    if (isNamespace && namespacePrefix.length === 0) return
    const name = isNamespace ? namespacePrefix : attributeName
    const kind = isNamespace ? ASTEngine.SymbolKind.Namespace : ASTEngine.SymbolKind.Property

    symbols.push({
      name,
      kind,
      range: this.nodeToRange(node),
      visibility: "public",
      ownerName,
      ownerKind: ASTEngine.SymbolKind.Class,
      metadata: {
        nodeType: node.type,
        isXmlAttribute: !isNamespace,
        isXmlNamespace: isNamespace,
        attributeName,
        value,
        namespacePrefix: isNamespace ? namespacePrefix : undefined,
        namespaceUri: isNamespace ? value : undefined,
      },
    })
    if (!publishedNames.has(`${ownerName}\u0000${name}`)) publishedNames.add(`${ownerName}\u0000${name}`)

    addRelationship(ownerName, name, ASTEngine.RelationshipType.Contains, {
      role: isNamespace ? "xml_namespace" : "xml_attribute",
      value,
      // M59 (#825): the name as WRITTEN. For `xmlns="…"` the edge's target is the
      // synthesised element name `default` (the default namespace has no written
      // prefix), which appears nowhere in the source — so a source check on the
      // target is unfixable by construction. Carrying `xmlns` (or `xmlns:pfx`)
      // lets the claim be checked against what is actually on the line.
      attributeName,
    }, nameNode)

    if (isNamespace || value === undefined) return

    // ── the cross-file / cross-type reference graph ───────────────────────────
    // An XSD is a graph of files and of types, and its edges are written as
    // attribute VALUES: `type="RootType"`, `base="xs:string"`, `ref="tns:item"`,
    // `xsi:type="…"`, `schemaLocation="../shared/common.xsd"`. Without these the
    // whole type graph of a project is invisible.
    //
    // The target is the LOCAL NAME, because that is the name a declaration in
    // this document (or in a sibling document sharing the namespace) carries. A
    // prefix never reaches the target, so an edge is not a VALUE published where
    // a NAME belongs — the M60.R10 defect class.

    if (attributeName === "schemaLocation") {
      // schemaLocation is a W3C-defined list of namespace/URI PAIRS whose URIs
      // are file paths. The attribute name is read from the tree; the split is
      // on the attribute's own value, never on the source text.
      // `schemaLocation` is defined as namespace/URI PAIRS, but a bare URI is
      // written just as often, so the pairing is decided by the token COUNT and
      // not assumed: an even count is pairs, an odd count is one bare URI.
      const parts = RealXmlAnalyzer.splitOnWhitespace(value)
      const paired = parts.length % 2 === 0 && parts.length >= 2
      let emitted = 0
      for (let i = paired ? 1 : 0; i < parts.length; i += paired ? 2 : 1) {
        const target = parts[i]
        if (!target || this.isRemoteUri(target)) continue
        addRelationship(ownerName, target, ASTEngine.RelationshipType.Imports, {
          role: "schema_location",
          attributeName,
          namespace: paired ? parts[i - 1] : undefined,
        }, valueNode)
        emitted++
      }
      if (emitted > 0) {
        // ONE symbol for the attribute, with every target it names on its
        // metadata. The first version pushed a symbol PER TARGET, so an
        // `xs:include` with two schemaLocations published `schemaLocation` three
        // times for one attribute (measured: 9,679 spurious symbols over the
        // 7,975-file corpus, 8,580 of them edges).
        const last = symbols[symbols.length - 1]
        if (last && last.name === attributeName && last.ownerName === ownerName) {
          last.metadata.schemaLocationTargets = parts.filter((_x, i) => paired ? i % 2 === 1 : true)
        }
        return
      }
    }

    if (this.bareNameReference) {
      // `<xsl:call-template name="render"/>` names a template declared elsewhere
      // in the same document. Not a QName (no prefix), so the prefix rule below
      // cannot see it; recorded as a bare-name reference and resolved in the
      // deferred pass, where the whole document's names are known.
      if (!nameNode || !valueNode) return
      referenceCandidates.push({
        ownerName,
        attributeName,
        value,
        nameNode,
        valueNode,
        binding: undefined,
        ownerNs,
        bareNameReference: true,
      })
      return
    }

    if (this.xsltCallElement && attributeName === "name" && valueNode) {
      // A CALL, not a reference (XSLT 1.0 §6). `return` on purpose: the generic
      // QName path below must not also see this attribute, or one `xsl:call-template`
      // would publish the same pair twice under two labels — the conflation the
      // `Labelled` question exists to catch. The value is a QName per §2.4, and a
      // template's name is read in the DEFAULT-less way the spec prescribes: an
      // unprefixed name is the template's own name.
      const colon = value.indexOf(":")
      const local = colon >= 0 ? value.slice(colon + 1) : value
      // No enclosing declaration means no caller to name, so the site is recorded
      // nowhere rather than against the instruction's own tag.
      if (local.length > 0 && local.length <= 256 && elementOwnerName) {
        callCandidates.push({ ownerName: elementOwnerName, templateName: local, valueNode: node, textNode: valueNode })
      }
      return
    }

    // XML Schema's `QName` datatype carries the `collapse` whiteSpace facet
    // (XSD 1.0 §3.3.13 / Part 2 §3.3.5.2), so a QName-typed attribute value has
    // its whitespace runs collapsed and trimmed BEFORE it is read as a name.
    // M60 X10: the analyzer did not, so `type="CT_GeoHierarchyEntity "` — a
    // trailing space, written by a human and perfectly legal, because XML only
    // normalises tab and newline in an attribute value and leaves inner spaces
    // alone — failed `asQName` and the reference was REFUSED. One such site in
    // the corpus, in office_drawing_2014_chartex.xsd, where a complex type
    // declared 7 lines above went unreferenced because of one space.
    //
    // Collapse-and-trim, not trim: the facet replaces every whitespace RUN with a
    // single space and then trims the ends, and `asQName` still rejects a value
    // with an interior space — which is the point, because `type="CT_ T"` is
    // genuinely not a QName and no amount of whitespace folding makes it one. A
    // fix that simply stripped the ends would accept neither more nor fewer
    // wrong values, and would be wrong about why.
    const collapsed = RealXmlAnalyzer.collapseWhitespace(value)
    const qname = this.asQName(collapsed)
    if (!qname || !nameNode || !valueNode) return
    // A PREFIX is the primary signal, and it is a signal the DOCUMENT supplies:
    // `tns:X` names a declaration, and no list of attribute names is consulted.
    // An UNPREFIXED value names a declaration only on an attribute declared to
    // carry one — otherwise `maxOccurs="unbounded"`, `use="required"` and
    // `w:val="Normal"` would each become a reference to a name that is not a
    // type, which is the M60.R10 class in reverse.
    if (!qname.prefix && !RealXmlAnalyzer.REFERENCE_ATTRIBUTES.has(attributeName)) return
    if (!qname.prefix && this.bareNameDeclarationElement) return
    // M60 X8: the `xml` and `xmlns` prefixes are bound by the Namespaces
    // specification ITSELF and need no declaration — `xmlns:xml=…` is forbidden,
    // and no real document writes it. So `namespaceBindings.get("xml")` is
    // undefined in every well-formed file, and every `ref="xml:lang"`,
    // `ref="xml:id"`, `ref="xml:space"` and `ref="xml:base"` came through with
    // NO binding. The reference pass then asked "is this a built-in?", found no
    // namespace to test, and REFUSED them — 71 references across 20 corpus files,
    // including every `xml:lang` in docx4j's Dublin Core schemas.
    //
    // The analyzer already knows the answer: BUILTIN_NAMESPACE_URIS contains
    // `http://www.w3.org/XML/1998/namespace`. It was consulted only when a
    // binding existed, and for the one prefix the spec guarantees can never
    // arrive with one. The knowledge was present and unreachable.
    const declared = namespaceBindings.get(qname.prefix)
    const binding = declared ?? RealXmlAnalyzer.IMPLICIT_PREFIX_BINDINGS[qname.prefix]
    if (this.xsdDerivationElement && attributeName === "base") {
      // DERIVATION, not a reference — XSD 1.0 §3.4.2. The queue carries the raw
      // value and the deferred pass re-parses it with the same `asQName`, so both
      // readers see one string and the resolution classes stay identical to the
      // reference pass they were factored from.
      derivationCandidates.push({
        ownerName,
        value: collapsed,
        binding,
        ownerNs,
        kind: this.derivationKind,
        valueNode,
        nameNode,
      })
      return
    }
    referenceCandidates.push({
      ownerName,
      attributeName,
      // The COLLAPSED value, not the raw one. The deferred pass re-parses
      // `candidate.value` with `asQName`, so storing the raw text meant the
      // facet was applied once for the push-site check and then thrown away —
      // the candidate passed the collapsed test here and failed the raw one
      // there, and the edge was refused exactly as before. One transformation,
      // at the point the value enters the queue, and both readers see the same
      // string. It also makes `metadata.qname` the reading the spec defines
      // rather than the bytes a human typed.
      value: collapsed,
      nameNode,
      valueNode,
      binding,
      ownerNs,
    })
  }

  /**
   * A QName is `NCName` or `NCName ':' NCName` with NOTHING else in the value.
   * Written as a character scan rather than a regular expression: the lane's rule
   * is that no regular expression does syntax work, and this is a syntax
   * decision about an attribute value.
   */
  private asQName(value: string): { prefix: string; local: string } | null {
    if (!value || value.length > 256) return null
    let colon = -1
    for (let i = 0; i < value.length; i++) {
      if (value[i] === ":") {
        if (colon >= 0) return null
        colon = i
      }
    }
    const prefix = colon < 0 ? "" : value.slice(0, colon)
    const local = colon < 0 ? value : value.slice(colon + 1)
    if (!this.isNcName(local)) return null
    if (colon >= 0 && !this.isNcName(prefix)) return null
    return { prefix, local }
  }

  /** XML `NCName` — the character set the grammar's own `Name` rule accepts. */
  private isNcName(text: string): boolean {
    if (text.length === 0) return false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      const alpha = (c >= "A" && c <= "Z") || (c >= "a" && c <= "z")
      const ok = i === 0
        ? alpha || c === "_"
        : alpha || (c >= "0" && c <= "9") || c === "_" || c === "." || c === "-" || c === ":"
      if (!ok) return false
    }
    return true
  }

  /** A URI with a scheme or an authority is not a repository-relative file path. */
  private isRemoteUri(target: string): boolean {
    for (let i = 0; i < target.length; i++) {
      const c = target[i]
      if (c === "/" || c === "\\" || c === ".") return false
      if (c === ":") return true
    }
    return false
  }

  /**
   * WHICH ATTRIBUTE carries a declaration's name, where `name` is not it.
   *
   * XSLT 1.0 §7.1 gives `xsl:output` no `name` at all: the output method IS its
   * name, written `method="html"`. That is the only such case measured across
   * the four vocabularies, and it is a table rather than a branch so that the
   * next one is a DECLARATION in the same place as the first, and so the
   * completeness gate can see that the attribute vocabulary is not silently
   * assumed to be `{name}`.
   */
  /**
   * Declared EMPTY, and that emptiness is the finding.
   *
   * This used to read `{ output: "method" }`, on the theory that XSLT
   * `xsl:output` names something. It does not: `method` names the output METHOD
   * (`xml`, `html`, `text`) and nothing else. So `<xsl:output method="xml"/>`
   * was published as a symbol called **`xml`**, marked `isVocabDeclaration`,
   * with `method`/`encoding`/`indent` hung off it as its attributes — and the
   * element's real name, `xsl:output`, appeared nowhere in the graph.
   *
   * That is the M60.R10 defect class in MIRROR IMAGE. R10 is publishing a VALUE
   * where a NAME belongs, into a `contains` target; this was taking a value
   * where a NAME belongs and calling the element IT. The comment on
   * REFERENCE_ATTRIBUTES above spends two paragraphs refusing to publish
   * `unbounded` and `Normal` as names, and then the declared-name table handed
   * `xml` to the graph in the very next screen. The corpus paid for it in
   * bug-128.xml and bug-92.xml, where `contains xsl:stylesheet -> xsl:output`
   * was missing and the element had been renamed to its own configuration.
   *
   * XSLT 2.0 does give `xsl:output` a `name`, for stylesheets that declare
   * several outputs — and `name` is already this function's default, so the
   * correct table is the empty one. `xsl:output` in XSLT 1.0, which is what
   * these files are, has no name at all and is correctly published under its
   * written name: it is an instruction, not a declaration.
   */
  private static readonly DECLARATION_NAME_ATTRIBUTE: Readonly<Record<string, string>> = {}

  /**
   * The DECLARED NAME of an element, when its vocabulary puts the name in an
   * attribute — and ONLY then.
   *
   * Returns null for every other element, which is the common case: a document's
   * elements are named by their tag, and an attribute that happens to be spelled
   * `name` is data. An ANONYMOUS inline declaration (`<xs:complexType>` with no
   * `name` inside an `<xs:element>`) is also null, and correctly so: an inline
   * type has no name, and publishing the tag for it is the honest reading.
   *
   * `nameNode` is the node the NAME ITSELF is written on, which is the AttValue
   * when the value is on a different line from the attribute keyword and the
   * whole Attribute otherwise. It is not the same node in both cases, and
   * picking the Attribute unconditionally was the whole of M19:
   *
   *     <xsd:element name=
   *         "InvalidModificationFault"
   *
   * (cxf/wsn/wsdl/rp-2.xsd) — the Attribute starts on 233, where the line reads
   * `<xsd:element name=` and carries no part of the name; the AttValue is on
   * 234. Anchoring to the Attribute reported 233, so a search for the name
   * landed one line above the string that spells it.
   */
  private declaredNameOf(
    namespaceUri: string | undefined,
    localName: string,
    tagNode: Node,
  ): { name: string; attribute: string; /** The node the NAME is written on — AttValue when it is on another line. */
    nameNode: Node } | null {
    if (!namespaceUri) return null
    const declaring = RealXmlAnalyzer.DECLARATION_VOCABULARIES[namespaceUri]
    if (!declaring || !declaring.has(localName)) return null
    const attribute = RealXmlAnalyzer.DECLARATION_NAME_ATTRIBUTE[localName] ?? "name"
    for (let i = 0; i < tagNode.namedChildCount; i++) {
      const node = tagNode.namedChild(i)
      if (node?.type !== "Attribute") continue
      const attrNameNode = this.findDirectChild(node, "Name")
      if (attrNameNode?.text.trim() !== attribute) continue
      const valueNode = this.findDirectChild(node, "AttValue")
      if (!valueNode) return null
      const value = this.unquote(valueNode.text).trim()
      if (value.length === 0 || value.length > 256) return null
      // The line the NAME is written on is the line carrying the VALUE. When the
      // value sits on another line from the attribute keyword, that is the value
      // node's line; when they share a line, both give the same answer and the
      // whole Attribute is the wider, more useful anchor.
      const anchor = valueNode.startPosition.row !== node.startPosition.row ? valueNode : node
      return { name: value, attribute, nameNode: anchor }
    }
    return null
  }

  /**
   * Splits on runs of whitespace as a CHAR WALK, never a regex.
   *
   * `schemaLocation` is the one attribute whose value is a token list rather than
   * a single name, and tokenising it is the only place this analyzer needs to cut
   * a value into words. `\s` was doing that job and it was the analyzer's last
   * regex — which made this doc's "zero regex usages" claim false and left the
   * machine census carrying that line as `needs_review` with an empty
   * justification. The census and the doc disagreed and the census was right.
   *
   * The character set is spelled out rather than borrowed from `\s` so the
   * behaviour is pinned to a stated set — space, tab, LF, CR, the XML `S`
   * production — instead of to a regex dialect.
   */
  /**
   * XML Schema's `collapse` whiteSpace facet, as a char walk.
   *
   * Every run of space/tab/LF/CR becomes ONE space, and the ends are trimmed.
   * This is the transformation the `collapse` facet defines, and it is NOT the
   * same as trimming: `"a  b"` collapses to `"a b"` rather than `"ab"`. Applied to
   * a QName-typed attribute value before the value is read as a name — see the
   * call site in the reference pass for why that matters and why an interior
   * space must still be refused afterwards.
   */
  private static collapseWhitespace(text: string): string {
    const out: string[] = []
    let pendingSpace = false
    let sawAny = false
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        // A leading run produces nothing at all; an interior one produces exactly
        // one space, however long the run was.
        if (sawAny) pendingSpace = true
        continue
      }
      if (pendingSpace) { out.push(" "); pendingSpace = false }
      out.push(text[i])
      sawAny = true
    }
    return out.join("")
  }

  private static splitOnWhitespace(text: string): string[] {
    const parts: string[] = []
    let start = -1
    for (let i = 0; i <= text.length; i++) {
      const c = i < text.length ? text.charCodeAt(i) : 0x20
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        if (start >= 0) { parts.push(text.slice(start, i)); start = -1 }
      } else if (start < 0) {
        start = i
      }
    }
    return parts
  }

  /**
   * Does `text` contain any code point JavaScript's `\s` matches?
   *
   * This is the analyzer's LAST regular expression, deleted. It stood at the
   * `PEReference` branch as `/\s/.test(ref)` — the predicate separating a parameter
   * entity REFERENCE (`%name;`) from the VALUE form (`% name '...'`) — and the doc
   * already claimed zero regex usages while the machine census carried that line as
   * unremoved. The census and the doc disagreed and the census was right.
   *
   * ## Why the class is spelled out and NOT narrowed to XML's own `S`
   *
   * The obvious replacement is {@link splitOnWhitespace}, since XML 1.0 §2.3 `S` is
   * `[ \t\r\n]` and that is the only whitespace a document may use BETWEEN tokens.
   * Narrowing to it is a behaviour change, and it was measured rather than assumed:
   * `validation/m14/fixtures/xml/pereference-shape-probe.mts` runs the deleted
   * predicate (`\s`), the narrowed one (`S`) and a `Name`-child lookup over every
   * `PEReference` node obtainable from the corpus, the lane's fixtures and eight
   * synthetic shapes.
   *
   *   - corpus: 0 nodes. The branch is not exercised by `$HOME/fixtures`
   *     at all, so no corpus number can decide this. The 22 admitted files whose
   *     text contains `<!ENTITY %` are bare `.dtd` fragments, which this grammar
   *     cannot root (no `document`), and the one admitted `.xml` — libxslt's
   *     `tests/xmlspec/REC-xml-20001006.xml` — carries its `<!ENTITY %` inside
   *     `CDSect`/`CDATA`, i.e. documentation ABOUT parameter entities.
   *   - fixtures: 4 nodes, `\s` and `S` agree on 4 of 4.
   *   - synthetic: 7 nodes, `\s` and `S` agree on 6 of 7. The one disagreement is
   *     `%p<U+00A0>e;`, where `\s` drops it and `S` publishes a symbol named
   *     `p<U+00A0>e` — a name no XML parser would accept, since `Name` is
   *     `[a-zA-Z_][a-zA-Z0-9_:.·-]*`. On that single node the wider class is the
   *     better answer, so this keeps it.
   *
   * ## Why the code points are listed rather than inherited
   *
   * The set is ECMAScript's `WhiteSpace` and `LineTerminator` productions, written
   * out so the behaviour is pinned to a stated list rather than to a dialect. It is
   * 25 code points and `isEcmaWhitespace` is total over them, which is what makes
   * this a replacement rather than an approximation: for any string, the answer is
   * identical to the deleted expression's, because both ask the same per-character
   * question and a character class is a per-character question.
   *
   * A narrower class WOULD be defensible here on XML grounds, and is recorded as a
   * limitation rather than shipped, because shipping it would change one measured
   * verdict on a shape the corpus cannot produce, which is the trade this lane has
   * no evidence to make.
   */
  private static containsEcmaWhitespace(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      if (RealXmlAnalyzer.isEcmaWhitespace(text.charCodeAt(i))) return true
    }
    return false
  }

  /** ECMAScript `\s`: `WhiteSpace` + `LineTerminator`. 25 code points, total. */
  private static isEcmaWhitespace(c: number): boolean {
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) return true // SP TAB LF CR
    if (c === 0x0b || c === 0x0c) return true                             // VT FF
    if (c === 0xa0) return true                                          // NBSP
    if (c === 0x1680) return true                                        // OGHAM SPACE MARK
    if (c >= 0x2000 && c <= 0x200a) return true                           // EN QUAD .. HAIR SPACE
    if (c === 0x2028 || c === 0x2029) return true                        // LS PS
    if (c === 0x202f || c === 0x205f) return true                        // NNBSP MMSP
    if (c === 0x3000) return true                                        // IDEOGRAPHIC SPACE
    if (c === 0xfeff) return true                                        // ZWNBSP
    return false
  }

  private isSchemaConstruct(name: string): boolean {
    const separator = name.lastIndexOf(":")
    const localName = separator >= 0 ? name.slice(separator + 1) : name
    switch (localName) {
      case "schema":
      case "element":
      case "attribute":
      case "complexType":
      case "simpleType":
      case "sequence":
      case "choice":
      case "all":
      case "group":
      case "attributeGroup":
      case "notation":
      case "import":
      case "include":
      case "redefine":
      case "annotation":
      case "documentation":
      case "appinfo":
      case "any":
      case "anyAttribute":
        return true
      default:
        return false
    }
  }

  /**
   * The DECLARATION a node sits inside, for a reference inside replacement text.
   *
   * `<!ENTITY % shared "… %other; …">` makes `shared` depend on `other`, and the
   * owner of that use is `shared` — not the DOCTYPE, and not an element. Same
   * reasoning as the `GEDecl` EntityValue case, reached by walking up to the
   * nearest declaration rather than by descending into it, because the reference
   * may be nested inside arbitrary markup in the replacement text.
   */
  private enclosingDeclaredName(node: Node): string | null {
    let cur: Node | null = node.parent
    let depth = 0
    while (cur && depth < 12) {
      if (cur.type === "GEDecl" || cur.type === "PEDecl" || cur.type === "NotationDecl") {
        const name = this.findDirectChild(cur, "Name")?.text.trim()
        return name && name.length > 0 ? name : null
      }
      cur = cur.parent
      depth++
    }
    return null
  }

  /**
   * Is this node inside a region the PARSER could not read?
   *
   * Walks up rather than asking the file: `errorNodes` is a whole-file count and
   * would label every edge in a partly-damaged document, which is the opposite of
   * what `recovery` is for. libxml2's `test/errors/*` is a corpus of
   * deliberately malformed documents whose only purpose is to be malformed, and
   * their parameter references are assertions about bytes no processor would accept.
   */
  /**
   * Is this node inside an entity's replacement text?
   *
   * Walks UP, deliberately: the question is about a node's POSITION, and asking
   * the node itself for an `EntityValue` child cannot answer it. See the call site
   * for what the first version got wrong.
   */
  private withinEntityValue(node: Node): boolean {
    let cur: Node | null = node.parent
    let depth = 0
    while (cur && depth < 12) {
      if (cur.type === "EntityValue") return true
      // A declaration boundary ends the question: replacement text cannot contain
      // a nested declaration, so nothing further up is this reference's business.
      if (cur.type === "GEDecl" || cur.type === "PEDecl" || cur.type === "NotationDecl") return false
      cur = cur.parent
      depth++
    }
    return false
  }

  private withinErrorRegion(node: Node): boolean {
    let cur: Node | null = node
    let depth = 0
    while (cur && depth < 24) {
      if (cur.type === "ERROR") return true
      if ((cur as any).isMissing) return true
      cur = cur.parent
      depth++
    }
    return false
  }

  private findDirectChild(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return null
  }

  /**
   * A named `Attribute` child of a tag node, by attribute name.
   *
   * Read off the TREE rather than off the tag's text: an attribute name is a `Name`
   * child inside an `Attribute` node, and three sibling attributes on one tag differ
   * only in which of their own `Name` children says `match`. Splitting the tag's text
   * would have to re-tokenise, and would match an attribute NAME that appears inside
   * another attribute's VALUE.
   */
  private findDirectAttribute(tagNode: Node, attrName: string): Node | null {
    for (let i = 0; i < tagNode.namedChildCount; i++) {
      const attr = tagNode.namedChild(i)
      if (attr?.type !== "Attribute") continue
      const nameNode = this.findDirectChild(attr, "Name")
      const text = nameNode?.text.trim()
      if (text === attrName) return attr
    }
    return null
  }

  /**
   * An attribute's value, unquoted and with the XML Schema `collapse` facet applied.
   *
   * `unquote` rather than a pattern, for the reason the rest of this analyzer spells
   * out: an `AttValue` is `"…"` or `'…'` in the tree, and only the quote characters
   * need removing. Returns `null` for an attribute written with no value, which is a
   * different thing from an empty value and must not collapse to `""`.
   */
  private attributeValueOf(tagNode: Node, attrName: string): string | null {
    const attr = this.findDirectAttribute(tagNode, attrName)
    if (!attr) return null
    const valueNode = this.findDirectChild(attr, "AttValue")
    if (!valueNode) return null
    return RealXmlAnalyzer.collapseWhitespace(this.unquote(valueNode.text.trim()))
  }

  private findFirstNamedChild(node: Node, types: Set<string>): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && types.has(child.type)) return child
    }
    return null
  }

  private descendantsOfType(node: Node, type: string): Node[] {
    const out: Node[] = []
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      for (let i = 0; i < current.namedChildCount; i++) {
        const child = current.namedChild(i)
        if (!child) continue
        if (child.type === type) out.push(child)
        stack.push(child)
      }
    }
    return out
  }

  private unquote(text: string): string {
    if (text.length >= 2) {
      const first = text[0]
      const last = text[text.length - 1]
      if ((first === "\"" || first === "'") && first === last) return text.slice(1, -1)
    }
    return text
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
}
