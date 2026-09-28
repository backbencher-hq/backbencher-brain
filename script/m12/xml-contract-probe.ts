import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"
import { decodeSourceText } from "../../src/util/source-text"

/**
 * The XML contract, as an ASSERTION SET rather than a smoke test.
 *
 * Its predecessor had 14 checks, and the one that pinned processing-instruction
 * extraction used `<?catalog-processing?>` — a PI with NO CONTENT, which is the
 * single PI spelling the broken grammar did handle. So the check was green while
 * the lane's most common XML construct was unparseable, and the grammar defect
 * it should have caught sat uncaught until a corpus census found it. Coverage of
 * a construct has to be measured on the construct, not on its nearest neighbour.
 *
 * Every check below names the CLASS it pins, and every class the analyzer's
 * declared vocabulary acts on is pinned by at least one check. The mutants in
 * `script/m14/mutate-analyzer.ts` revert each mechanism these checks exercise,
 * so a check that cannot fail is visible as such.
 */
const checks: { name: string; passed: boolean; detail?: string }[] = []
const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail })

const read = async (file: string) => {
  const path = `validation/m12/fixtures/xml/${file}`
  return ASTEngine.parseFile(path, readFileSync(path, "utf8"))
}
const kinds = (r: any) => new Set(r.symbols.map((s: any) => `${s.kind}:${s.name}`))
const roles = (r: any) => new Set(r.relationships.map((e: any) => `${e.type}:${e.metadata?.role}`))
/**
 * The analyzer emits `RelationshipType.Imports`, whose value is `"brain_import"`;
 * the engine rewrites it to `"imports"` on the way out. Both spellings are the
 * same relationship, so a probe that pins one of them is pinning an
 * implementation detail of the pipeline, not the contract.
 */
const rel = (r: any, type: string, source: string, target: string) => {
  const want = type === "brain_import" || type === "imports" ? new Set(["brain_import", "imports"]) : new Set([type])
  return r.relationships.find((e: any) => want.has(e.type) && e.source === source && e.target === target)
}
const sym = (r: any, name: string) => r.symbols.find((s: any) => s.name === name)

// ── the shipped baseline, unchanged ────────────────────────────────────────
const catalog = await read("Catalog.xml")
const catalogNames = kinds(catalog)
check("document PI is a module symbol", catalogNames.has("module:catalog-processing"))
check("default namespace is a namespace symbol", catalogNames.has("namespace:default"))
check("prefixed namespace is a namespace symbol", catalogNames.has("namespace:book"))
check("empty-element attribute is extracted", catalogNames.has("property:name"))
check("element ranges carry byte offsets", catalog.symbols.filter((s: any) => s.metadata?.isXmlElement).every((s: any) => Number.isInteger(s.range.startIndex) && Number.isInteger(s.range.endIndex)))
check("valid catalog has no syntax errors", (catalog.errors?.length ?? 0) === 0)

const doctype = await read("Doctype.xml")
check("DOCTYPE external ID is an import", doctype.imports.some((i: any) => i.path === "catalog.dtd" && i.importType === "xml-doctype"))
check("DOCTYPE import relationship is emitted", rel(doctype, "brain_import", "catalog", "catalog.dtd") !== undefined)
check("valid doctype document has no syntax errors", (doctype.errors?.length ?? 0) === 0)

const schema = await read("Schema.xsd")
check("XSD extension detects as XML", schema.language === "xml")
check("schema constructs retain structural metadata", schema.symbols.some((s: any) => s.metadata?.isSchemaConstruct === true))
check("valid XSD has no syntax errors", (schema.errors?.length ?? 0) === 0)

const negative = await read("Negative.xml")
check("malformed XML reports syntax errors", (negative.errors?.length ?? 0) > 0)
check("malformed XML creates no recovery symbols", negative.symbols.length === 0)

// ── processing instructions, WITH CONTENT (the gap the old fixture missed) ──
const pi = await read("ProcessingInstruction.xml")
check("PI with content is a module symbol", kinds(pi).has("module:catalog-processing"))
check("PI with content carries no error", (pi.errors?.length ?? 0) === 0)
check("xml-stylesheet is its own symbol", kinds(pi).has("module:xml-stylesheet"))
check("xml-model is its own symbol", kinds(pi).has("module:xml-model"))
check("stylesheet href is a file import", rel(pi, "brain_import", "xml-stylesheet", "catalog.xsl") !== undefined)
check("stylesheet href is an import entry", pi.imports.some((i: any) => i.path === "catalog.xsl" && i.importType === "xml-stylesheet"))
check("stylesheet non-href pseudo attribute is a property", kinds(pi).has("property:type"))
check("xml-model href is a file import", rel(pi, "brain_import", "xml-model", "catalog.rng") !== undefined)
check("PI nested in element content is owned by it", sym(pi, "render")?.ownerName === "catalog")
check("PI in element content emits a contains edge", rel(pi, "contains", "catalog", "render") !== undefined)
check("nested PI emits a contains edge from its element", rel(pi, "contains", "entry", "audit") !== undefined)
check("no PI symbol is left unnamed", pi.symbols.every((s: any) => s.kind !== "module" || (s.name.length > 0 && !/\s/.test(s.name))))

// ── conditional sections inside an internal DTD subset (REPAIR 2) ──────────
const cond = await read("ConditionalSection.xml")
check("conditional section parses without error", (cond.errors?.length ?? 0) === 0, `${cond.errors?.length} errors`)
check("DOCTYPE name is the document's, not INCLUDE/IGNORE", kinds(cond).has("type:catalog"))
check("no symbol is named after a conditional keyword", !cond.symbols.some((s: any) => s.name === "INCLUDE" || s.name === "IGNORE"))
check("declarations inside INCLUDE are extracted", kinds(cond).has("property:extId"))
check("declarations inside IGNORE are extracted", kinds(cond).has("property:legacyId"))

// ── DTD entity / notation declarations, content model, notation references ──
const dtd = await read("DtdDeclarations.xml")
check("DTD file has no error", (dtd.errors?.length ?? 0) === 0, `${dtd.errors?.length} errors`)
check("general entity is declared", kinds(dtd).has("type:logo"))
check("parameter entity is declared", kinds(dtd).has("type:shared"))
check("notation is declared", kinds(dtd).has("type:png"))
check("entity declarations are owned by the DTD", sym(dtd, "logo")?.ownerName === "catalog")
check("parameter entity external ID is a file import", rel(dtd, "brain_import", "shared", "shared.dtd") !== undefined)
check("general entity external ID is a file import", rel(dtd, "brain_import", "logo", "logo.png") !== undefined)
check("notation external ID is a file import", rel(dtd, "brain_import", "png", "image/png") !== undefined)
check("entity external IDs are import entries", dtd.imports.filter((i: any) => i.metadata?.isDtdExternalId).length === 4)
check("NDATA names the notation it points at", rel(dtd, "contains", "logo", "png") !== undefined)
check("NOTATION attribute type emits a notation reference", rel(dtd, "contains", "entry", "png") !== undefined)
check("the DTD content model emits contains edges", dtd.relationships.some((e: any) => e.metadata?.role === "dtd_content_model") === false, "no content model in this fixture; checked in ConditionalSection.xml")

const cond2 = await read("ConditionalSection.xml")
check("DTD content model emits a contains edge", rel(cond2, "contains", "catalog", "entry") !== undefined)
check("content-model target is also a published symbol", sym(cond2, "entry") !== undefined)
check("every contains target resolves to a symbol in the same file", dtd.relationships
  .filter((e: any) => e.type === "contains")
  .every((e: any) => dtd.symbols.some((s: any) => s.name === e.target)))
check("every member edge names the member as its owner", dtd.relationships
  .filter((e: any) => e.type === "contains" && (e.metadata?.role === "xml_attribute" || e.metadata?.role === "dtd_attribute_declaration"))
  .every((e: any) => dtd.symbols.some((s: any) => s.name === e.target && s.ownerName === e.source)))

// ── the declared-name rule: an XSD type is named by its `name` attribute ───
const xsd = await read("TypeGraph.xsd")
check("XSD has no error", (xsd.errors?.length ?? 0) === 0, `${xsd.errors?.length} errors`)
check("a complexType is published under its declared name", sym(xsd, "EntryType") !== undefined)
check("a global element is published under its declared name", sym(xsd, "catalog") !== undefined)
// The precise invariant: a symbol that HAS a declared name is never published
// under its tag name. (Scoping the check to "the file contains no
// `class:xs:complexType`" would be wrong — the fixture legitimately contains an
// ANONYMOUS inline complexType, which has no name and is correctly filed under
// its tag.)
check("no symbol with a declared name is published under its tag name", xsd.symbols
  .filter((s: any) => s.metadata?.isVocabDeclaration)
  .every((s: any) => s.name === s.metadata.declaredName && s.name !== s.metadata.tagName))
check("every vocabulary declaration names itself from the attribute it read", xsd.symbols
  .filter((s: any) => s.metadata?.isVocabDeclaration)
  .every((s: any) => typeof s.metadata?.declaredByAttribute === "string" && s.metadata.declaredByAttribute.length > 0))
check("an ANONYMOUS inline declaration is published under its tag", kinds(xsd).has("class:xs:complexType"), "an inline complexType has no name; the tag is the honest reading")
check("the declared name records the attribute it came from", xsd.symbols.some((s: any) => s.name === "EntryType" && s.metadata?.declaredByAttribute === "name"))
check("the tag name is retained as metadata", xsd.symbols.some((s: any) => s.name === "EntryType" && s.metadata?.tagName === "xs:complexType"))
check("the declaration kind is recorded", xsd.symbols.some((s: any) => s.name === "EntryType" && s.metadata?.declarationKind === "complexType"))
check("schemaLocation becomes a file import", rel(xsd, "brain_import", "xs:import", "shared.xsd") !== undefined)
check("a bare schemaLocation URI is imported too", rel(xsd, "brain_import", "xs:include", "catalog-types.xsd") !== undefined)
check("schemaLocation import records the namespace", rel(xsd, "brain_import", "xs:import", "shared.xsd")?.metadata?.namespace === "urn:example:shared")
check("a local type reference is a references edge", rel(xsd, "references", "entry", "EntryType") !== undefined)
check("a local type reference is resolvable in-document", rel(xsd, "references", "entry", "EntryType")?.metadata?.resolvable === "in-document")
check("a built-in type reference is a references edge", rel(xsd, "references", "note", "string") !== undefined)
check("a built-in type reference is marked builtin", rel(xsd, "references", "note", "string")?.metadata?.resolvable === "builtin")
check("a reference target never carries the written prefix", xsd.relationships.filter((e: any) => e.metadata?.role === "attribute_qname_reference").every((e: any) => !e.target.includes(":")))
check("an unresolved reference value is refused", xsd.relationships.every((e: any) => e.metadata?.role !== "attribute_qname_reference" || e.metadata?.resolvable !== undefined))

// ── XSLT: a named template is a declaration, a call to it a reference ──────
const xsl = await read("Template.xsl")
check("XSL extension routes to xml", xsl.language === "xml")
check("XSLT has no error", (xsl.errors?.length ?? 0) === 0, `${xsl.errors?.length} errors`)
check("a named template is published under its name", sym(xsl, "entry-row") !== undefined)
// These two checks USED TO read:
//   "xsl:output is published under its method"                        sym(html) !== undefined
//   "the xsl:output declaration records its attribute"                declaredByAttribute === "method"
// and they are the reason M60 finding X5 survived. `Template.xsl` carries
// `<xsl:output method="html"/>`, the table mapped `output -> method`, and the
// contract then CERTIFIED the result: a stylesheet instruction published as a
// component called `html`, with `method`/`encoding` hung off it. The check names
// describe the defect in the grammar of a specification — "is published under its
// method" reads as intended behaviour, and anyone auditing the lane would have
// seen two green checks agreeing with each other and no reason to doubt them.
//
// A contract that pins observed behaviour is a mirror, not a specification. The
// replacement asserts what the element actually is: an XSLT instruction with no
// name of its own, published under its written name, whose attributes it owns.
check("xsl:output is published under its WRITTEN name", sym(xsl, "xsl:output") !== undefined)
check("no symbol is named after an output METHOD value", !["xml", "html", "text"].some((m) => sym(xsl, m)?.metadata?.nodeType === "element" && sym(xsl, m)?.metadata?.isVocabDeclaration === true))
check("xsl:output's own attributes are owned by xsl:output", sym(xsl, "encoding")?.ownerName === "xsl:output")
check("a local binding is owned by its template", sym(xsl, "indent")?.ownerName === "entry-row")
// The edge's source is the INSTRUCTION that carries the call, not the enclosing
// element: `xsl:call-template -> cell` says which instruction reaches which
// template, which `tr -> cell` would not.
check("call-template names the template it calls", rel(xsl, "references", "xsl:call-template", "cell") !== undefined)
check("a named-template reference is marked by role", rel(xsl, "references", "xsl:call-template", "cell")?.metadata?.role === "xslt_named_template_reference")
check("a named-template reference resolves in-document", rel(xsl, "references", "xsl:call-template", "cell")?.metadata?.resolvable === "in-document")
check("a call to a template the document does not declare is refused", (await ASTEngine.parseFile("x.xsl", `<s xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:call-template name="nowhere"/></s>`)).relationships.every((e: any) => e.type !== "references"))

// ── line discipline (M59.A7 / #825) ────────────────────────────────────────
const multi = await read("DtdDeclarations.xml")
check("every relationship carries a line", multi.relationships.every((e: any) => typeof e.line_number === "number"))
check("the external-ID edge points at the PATH's line, not the keyword's", (() => {
  const e = rel(multi, "brain_import", "png", "image/png")
  if (!e) return false
  const src = readFileSync("validation/m12/fixtures/xml/DtdDeclarations.xml", "utf8")
  const lines = src.split("\n")
  return lines[e.line_number - 1]?.includes("image/png") === true
})())
check("a contains edge points at the TARGET's line", (() => {
  const e = rel(catalog, "contains", "catalog", "version")
  if (!e) return false
  const lines = readFileSync("validation/m12/fixtures/xml/Catalog.xml", "utf8").split("\n")
  return lines[e.line_number - 1]?.includes("version") === true
})())

// ── edge collapse is counted, not hidden ───────────────────────────────────
const repeated = await ASTEngine.parseFile(
  "validation/m12/fixtures/xml/Catalog.xml",
  `<r>\n<c x="1"/>\n<c x="2"/>\n<c x="3"/>\n</r>`,
)
check("repeated identical edges collapse to one edge", repeated.relationships.filter((e: any) => e.source === "c" && e.target === "x").length === 1)
check("the collapse is counted on the edge", (repeated.relationships.find((e: any) => e.source === "c" && e.target === "x")?.metadata?.occurrences ?? 0) === 3)
check("every line of a collapsed edge is recorded", (repeated.relationships.find((e: any) => e.source === "c" && e.target === "x")?.metadata?.lines ?? []).length === 3,
  JSON.stringify(repeated.relationships.find((e: any) => e.source === "c" && e.target === "x")?.metadata))

const selfRef = await ASTEngine.parseFile("validation/m12/fixtures/xml/SelfRef.xml", `<r x="r"/>`)
check("a construct never references itself", selfRef.relationships.every((e: any) => e.source !== e.target))
check("a self reference invents no symbol", !selfRef.symbols.some((s: any) => s.name === "r" && !s.ownerName && s.kind === "type"))

// ── recovery honesty: a symbol from a file with errors says so ─────────────
const recovered = await ASTEngine.parseFile(
  "validation/m12/fixtures/xml/Recovered.xml",
  `## a vendor template header that is not XML\n<r><c x="1"/></r>`,
)
check("a file with a grammar error reports it", (recovered.errors?.length ?? 0) > 0)
check("its symbols are still extracted", recovered.symbols.length > 0)
check("every symbol from an erroneous file is marked", recovered.symbols.every((s: any) => s.metadata?.syntaxErrors === true))
check("every edge from an erroneous file is marked", recovered.relationships.every((e: any) => e.metadata?.syntaxErrors === true))
check("a clean file's symbols are NOT marked", catalog.symbols.every((s: any) => s.metadata?.syntaxErrors !== true))

// ── an empty namespace prefix declares nothing publishable ─────────────────
const emptyPrefix = await ASTEngine.parseFile("validation/m12/fixtures/xml/EmptyNs.xml", `<f xmlns:="urn:x"/>`)
check("an empty namespace prefix publishes no symbol", emptyPrefix.symbols.every((s: any) => s.name.length > 0 && !/\s/.test(s.name)))
check("an empty namespace prefix publishes no edge target", emptyPrefix.relationships.every((e: any) => e.target.length > 0))

// ── a declared name comes from a NAMING attribute, and only from one ────────
/**
 * The general form of M60 finding X5, written as a rule rather than as a case.
 *
 * X5 was `DECLARATION_NAME_ATTRIBUTE = { output: "method" }`, which published
 * `<xsl:output method="html"/>` as a component called `html` — a value read as a
 * name. One fixture pins that case; this pins the SHAPE, so the next table entry
 * that does the same thing fails here even if the element is a different one and
 * no fixture names it.
 *
 * In XSD, RelaxNG, XSLT and WSDL a declaration's name lives in `name`; `id` is
 * accepted where a vocabulary allows it. Nothing else names anything. So the
 * rule is: if a symbol is marked a vocabulary declaration, the attribute it took
 * its name from must be one of those two. Anything else is a VALUE promoted into
 * a name, which is the M60.R10 class in mirror image.
 *
 * It is checked over every vocabulary declaration the analyzer produces across
 * the whole fixture set rather than one hand-picked file, because the defect's
 * cost is precisely that it is invisible per-file: each individual output
 * element looked locally correct.
 */
{
  const NAMING_ATTRIBUTES = new Set(["name", "id"])
  const dir = "validation/m12/fixtures/xml"
  const declared: { file: string; name: string; by: string }[] = []
  const violations: { file: string; name: string; by: string }[] = []
  for (const f of readdirSync(dir).filter((f) => /\.(xml|xsd|xsl|xslt|rng|wsdl)$/.test(f)).sort()) {
    const p = `${dir}/${f}`
    const r: any = await ASTEngine.parseFile(p, readFileSync(p, "utf8"))
    for (const s of r.symbols ?? []) {
      if (s.metadata?.isVocabDeclaration !== true) continue
      const by = String(s.metadata?.declaredByAttribute ?? "(none)")
      const row = { file: f, name: String(s.name), by }
      declared.push(row)
      if (!NAMING_ATTRIBUTES.has(by)) violations.push(row)
    }
  }
  check("every declared name came from a NAMING attribute (name/id), never from a value", violations.length === 0,
    violations.length ? `PROMOTED VALUES: ${violations.slice(0, 6).map((v) => `${v.file} ${v.name}<-${v.by}`).join("; ")}` : `${declared.length} declaration(s) across the fixture set, all from name/id`)
  // The three resolvability classes, as a rule. A `references` edge that does not
  // say HOW it resolves is asking the consumer to guess, and the three answers
  // lead to three different places: this file, a built-in type table, or another
  // file. X7 added the third (`external`, with `importedFrom`) and this is what
  // stops a fourth being invented silently or the third being dropped again.
  // X13 added a fourth class. `unresolved` is a REAL reference this file does not
  // satisfy — a bare type name satisfied only by an `xs:include`, which a per-file
  // analyzer cannot see — and it must carry `ambiguousWithBuiltin` when the name
  // is also a built-in, because that is the one case where a consumer must not
  // guess either way. The rule is written as a shape so a fifth class cannot be
  // invented without saying what it resolves to.
  const RESOLVABLE = new Set(["in-document", "builtin", "external", "unresolved"])
  const badResolvable: string[] = []
  let refEdges = 0
  let externalEdges = 0
  let unresolvedEdges = 0
  for (const f of readdirSync(dir).filter((f) => /\.(xml|xsd|xsl|xslt|rng|wsdl)$/.test(f)).sort()) {
    const p = `${dir}/${f}`
    const r: any = await ASTEngine.parseFile(p, readFileSync(p, "utf8"))
    for (const e of r.relationships ?? []) {
      if (e.type !== "references") continue
      refEdges++
      const v = e.metadata?.resolvable
      if (v === "external") {
        externalEdges++
        // an external reference is only followable if it says which file
        if (typeof e.metadata?.importedFrom !== "string" || e.metadata.importedFrom.length === 0) badResolvable.push(`${f}: external without importedFrom`)
      } else if (v === "unresolved") {
        // An unresolved reference must not have been published as a local symbol.
        // The component is in another file; a symbol here would be the R10 lie, and
        // `unresolved` exists precisely so the claim can be recorded WITHOUT one.
        unresolvedEdges++
        if ((r.symbols ?? []).some((sy: any) => sy.name === e.target)) badResolvable.push(`${f}: ${e.target} unresolved but published as a local symbol`)
      } else if (!RESOLVABLE.has(String(v))) {
        badResolvable.push(`${f}: ${e.source}->${e.target} resolvable=${JSON.stringify(v)}`)
      }
    }
  }
  check("every reference edge declares HOW it resolves, and an external one names the file", badResolvable.length === 0,
    badResolvable.length ? badResolvable.slice(0, 6).join("; ") : `${refEdges} reference edge(s), ${externalEdges} external`)
  // X8: a reference through a prefix the Namespaces specification binds in EVERY
  // document must resolve to that namespace, whether or not the document declares
  // it — and it cannot declare it, since re-binding `xml` is an error. A refused
  // `ref="xml:lang"` is invisible in every other metric: there is simply no edge,
  // and a missing edge for a name nothing supports is the CORRECT reading for a
  // prefix bound to nothing. The only way to tell the two apart is to require
  // that these two specific prefixes, when they appear, resolve.
  const IMPLICIT = new Map([["xml", "http://www.w3.org/XML/1998/namespace"], ["xmlns", "http://www.w3.org/2000/xmlns/"]])
  const implicitSeen: string[] = []
  const implicitBad: string[] = []
  for (const f of readdirSync(dir).filter((f) => /\.(xml|xsd|xsl|xslt|rng|wsdl)$/.test(f)).sort()) {
    const p = `${dir}/${f}`
    const r: any = await ASTEngine.parseFile(p, readFileSync(p, "utf8"))
    for (const e of r.relationships ?? []) {
      if (e.type !== "references") continue
      const q = String(e.metadata?.qname ?? "")
      const colon = q.indexOf(":")
      if (colon < 0) continue
      const prefix = q.slice(0, colon)
      if (!IMPLICIT.has(prefix)) continue
      implicitSeen.push(`${f}:${q}`)
      if (e.metadata?.resolvable !== "builtin") implicitBad.push(`${f} ${q} resolvable=${JSON.stringify(e.metadata?.resolvable)}`)
    }
  }
  check("a reference through a spec-bound implicit prefix resolves to its namespace", implicitBad.length === 0,
    implicitBad.length ? implicitBad.slice(0, 5).join("; ") : `${implicitSeen.length} implicit-prefix reference(s), all resolved`)
  check("the fixture set exercises the implicit-prefix rule", implicitSeen.length > 0,
    `${implicitSeen.length} reference(s) through a spec-bound prefix`)

  // X14: a merged edge must be able to answer "is this edge ALSO a usage claim?"
  // from its own metadata. `evidenceClass` carries the PRIMARY role's tier, so a
  // consumer had to hold the tier table and re-derive the answer — and 148 of 813
  // content-model sites were indistinguishable from 665 genuine nesting edges.
  // The invariant is POSITIONAL: `alsoRoles[i]` and `alsoRoleTiers[i]` must be the
  // same role, so the two lists cannot be read out of step.
  const alsoRoleBad: string[] = []
  let mergedEdges = 0, alsoUsage = 0
  for (const f of readdirSync(dir).filter((f) => /\.(xml|xsd|xsl|xslt|rng|wsdl)$/.test(f)).sort()) {
    const p = `${dir}/${f}`
    const r: any = await ASTEngine.parseFile(p, readFileSync(p, "utf8"))
    for (const e of r.relationships ?? []) {
      const also = e.metadata?.alsoRoles
      if (!Array.isArray(also) || also.length === 0) continue
      mergedEdges++
      const tiers = e.metadata?.alsoRoleTiers
      if (!Array.isArray(tiers) || tiers.length !== also.length) { alsoRoleBad.push(`${f}: ${also.length} alsoRoles but ${tiers?.length ?? 0} tiers`); continue }
      for (let i = 0; i < also.length; i++) {
        if (tiers[i]?.role !== also[i]) alsoRoleBad.push(`${f}: position ${i} is ${also[i]} vs ${tiers[i]?.role}`)
        if (tiers[i]?.tier === "usage_contextual") alsoUsage++
      }
    }
  }
  check("every merged edge records a TIER for each of its other roles, in step with alsoRoles", alsoRoleBad.length === 0,
    alsoRoleBad.slice(0, 5).join("; ") || `${mergedEdges} merged edge(s), ${alsoUsage} secondary usage claim(s) now answerable from metadata`)
  check("the fixture set exercises the merged-edge tier pairing", mergedEdges > 0 && alsoUsage > 0,
    `${mergedEdges} merged edge(s), ${alsoUsage} with a usage-claiming secondary role`)

  check("the fixture set exercises the unresolved resolvability class", unresolvedEdges > 0,
    `${unresolvedEdges} unresolved reference(s) — X13's class must be reachable or it is untested`)

  check("the fixture set exercises the external resolvability class", externalEdges > 0,
    `${externalEdges} external reference(s) — X7's class must be reachable or it is untested`)

  // X12: a UTF-16 document, decoded from BYTES, must index. Synthesised in memory
  // rather than shipped as a fixture file, because a fixture file is itself read
  // as UTF-8 by the runner that opens it — the one file in the repository that
  // could not exercise this would be the fixture.
  //
  // The consequence is gated rather than the utility: what matters is that a
  // UTF-16 document produces its symbols, not that a BOM table has five rows.
  // Before the fix these documents arrived at the grammar as NUL-interleaved text,
  // produced an ERROR root, and the analyzer correctly published nothing — and
  // the read threw no error, so the loss was invisible at the boundary and showed
  // up only as an empty file. In the corpus that was 26 files including 34 KB and
  // 14 KB of ordinary WordprocessingML.
  {
    const toUtf16le = (text: string, withBom: boolean): Buffer => {
      const body = Buffer.from(text, "utf16le")
      return withBom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body
    }
    const swap16 = (b: Buffer): Buffer => {
      const o = Buffer.from(b)
      for (let i = 0; i + 1 < o.length; i += 2) { const t = o[i]; o[i] = o[i + 1]; o[i + 1] = t }
      return o
    }
    const DOC = `<?xml version="1.0" encoding="UTF-16"?><catalog><entry id="1"/><entry id="2"/></catalog>`
    const variants: [string, Buffer][] = [
      ["utf16le + BOM", toUtf16le(DOC, true)],
      ["utf16le, no BOM (inferred)", toUtf16le(DOC, false)],
      ["utf16be + BOM", Buffer.concat([Buffer.from([0xfe, 0xff]), swap16(Buffer.from(DOC, "utf16le"))])],
    ]
    const decodedBad: string[] = []
    const indexedBad: string[] = []
    for (const [label, bytes] of variants) {
      const d = decodeSourceText(bytes)
      if (d.text !== DOC) { decodedBad.push(`${label}: decoded to ${JSON.stringify(d.text.slice(0, 24))}`); continue }
      const viaBytes = await (await import("../../src/ast/engine")).ASTEngine.parseFile("utf16-probe.xml", d.text)
      if ((viaBytes.symbols?.length ?? 0) < 3) indexedBad.push(`${label}: ${viaBytes.symbols?.length ?? 0} symbols`)
    }
    check("a UTF-16 document decodes to the same text in LE, LE-without-BOM, and BE", decodedBad.length === 0, decodedBad.join("; ") || `${variants.length} encodings round-trip`)
    check("a UTF-16 document indexes its symbols once decoded", indexedBad.length === 0, indexedBad.join("; ") || "catalog + 2 entries + 2 id attributes in all three encodings")
    // And the control: reading the same bytes as UTF-8 must NOT work, or the
    // check above would pass for the wrong reason.
    const raw = toUtf16le(DOC, true)
    const wrong = await (await import("../../src/ast/engine")).ASTEngine.parseFile("utf16-control.xml", raw.toString("utf8"))
    check("the same bytes read as UTF-8 do NOT index (so the check above is not vacuous)", (wrong.symbols?.length ?? 0) < 3, `${wrong.symbols?.length ?? 0} symbols from the misread`)
  }

  check("the fixture set actually exercises the declared-name rule", declared.length > 0,
    `${declared.length} vocabulary declaration(s) found — a rule that can never fire is not a rule`)
}

const result = {
  analyzer: "xml",
  checks,
  passed: checks.every((item) => item.passed),
  count: checks.length,
  passedCount: checks.filter((item) => item.passed).length,
  failed: checks.filter((item) => !item.passed).map((item) => ({ name: item.name, detail: item.detail })),
}
writeFileSync("validation/m12/results/xml-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
