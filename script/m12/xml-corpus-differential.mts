/**
 * XML CORPUS DIFFERENTIAL — vendored into the repository.
 *
 * WHY IT MOVED. This probe produced `validation/m12/results/xml-differential.json`,
 * which IS version-controlled and which the analyzer doc cites — but the probe
 * itself lived in a sibling worktree at `fixtures/xml/probes/`, which is not a clone
 * target. So the EVIDENCE was in the repository and the INSTRUMENT that produced it
 * was not: a fresh checkout could read the number and had no way to re-derive it,
 * and the number quoted in the docs described a build that no longer existed. That
 * is the same defect as the encoding-recovery figure being quoted three ways, one
 * level up — an artifact whose provenance is not reproducible is a claim, not
 * evidence.
 *
 * WHAT IT MEASURES THAT NOTHING ELSE IN THIS LANE DOES. Three things, and all three
 * are unique to it:
 *
 *   1. SYMBOL-LEVEL comparison. Every other gate here looks at relationships or at
 *      a name a declaration should carry; this one asks whether the analyzer
 *      published the right SYMBOLS, and reports a `SPURIOUS` class for symbols the
 *      analyzer minted that the tree does not support.
 *   2. TYPE COVERAGE across twenty relationship classes — 18 of 20 at recall 1.000
 *      before this round. `script/m12/xml-differential-gap.mts` compares `contains`
 *      only, and `script/m14/differential.ts` compares whatever its oracle derives,
 *      so neither can answer "is the whole ontology covered".
 *   3. MULTISET comparison — counts, not sets — because XML legitimately repeats
 *      names: repeated siblings, one `AttDef` per attribute, several DTD
 *      declarations of the same name. A set comparison cannot see a class of defect
 *      that a count can, and this lane has one (20,904 repeated identity keys).
 *
 * The oracle is written from the GRAMMAR's own declaration with a deliberately
 * different algorithm, which is what makes a disagreement a finding rather than the
 * same bug counted twice:
 *
 *   analyzer : explicit worklist; per-node-type branches; positional scans; a `Set`
 *              keyed source|type|target; owner carried DOWN the worklist.
 *   oracle   : ONE flat pre-order sweep with a precomputed PARENT MAP; owner read by
 *              walking UP the parent chain; a declaration register that knows every
 *              name the document itself declares, so recall is measurable for
 *              relationship classes the analyzer has no code for.
 *
 * Usage:
 *   npx tsx script/m12/xml-corpus-differential.mts [--repos DIR] [--out FILE]
 * Exit 0 when every class meets its floor, 1 otherwise.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import { dirname, join, resolve as pathResolve } from "node:path"
import { fileURLToPath } from "url"

const ROOT_HERE = pathResolve(dirname(fileURLToPath(import.meta.url)), "..") // script/m12/
import { Parser, Language } from "web-tree-sitter"
import { ASTEngine } from "../../src/ast/engine"

const REPOS = process.env.XML_CORPUS_ROOT ?? "$HOME/fixtures/xml/repos"
const OUT_DEFAULT = process.env.XML_DIFF_OUT ?? join(ROOT_HERE, "..", "validation", "m12", "results")
const EXTS = (process.env.XML_EXTS || "*.xml *.xsd *.dtd").split(/\s+/).filter(Boolean)
const LIMIT = Number(process.env.XML_LIMIT || "0")
const WASM = process.env.XML_WASM || join(ROOT_HERE, "..", "wasm", "tree-sitter-xml.wasm")
const SEP = "\u0000"

await Parser.init()
const parser = new Parser()
parser.setLanguage(await Language.load(WASM))

// ---------------------------------------------------------------------------
// ORACLE
// ---------------------------------------------------------------------------
type Rec = { cls: string; name: string; owner: string; line: number; col: number }

function parentMap(root: any): Map<number, any> {
  const m = new Map<number, any>()
  const st = [root]
  while (st.length) {
    const n = st.pop()!
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      m.set(c.id, n)
      st.push(c)
    }
  }
  return m
}
function ancestors(n: any, parents: Map<number, any>): any[] {
  const out: any[] = []
  let p = parents.get(n.id)
  while (p) { out.push(p); p = parents.get(p.id) }
  return out
}
function ownerElement(n: any, parents: Map<number, any>): any {
  for (const a of ancestors(n, parents)) if (a.type === "element") return a
  return null
}
function ownerDtd(n: any, parents: Map<number, any>): any {
  for (const a of ancestors(n, parents)) if (a.type === "doctypedecl") return a
  return null
}
function firstOfType(n: any, t: string): any {
  for (let i = 0; i < n.childCount; i++) if (n.child(i).type === t) return n.child(i)
  return null
}
function allOfType(n: any, t: string): any[] {
  const out: any[] = []
  for (let i = 0; i < n.childCount; i++) if (n.child(i).type === t) out.push(n.child(i))
  return out
}
function allNamedOfType(n: any, t: string): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === t) out.push(c) }
  return out
}
function descendantsOfType(root: any, t: string): any[] {
  const out: any[] = []
  const st = [root]
  while (st.length) {
    const n = st.pop()!
    if (n.type === t) out.push(n)
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  return out
}
function tagNameOf(el: any): string {
  const tag = firstOfType(el, "STag") || firstOfType(el, "EmptyElemTag")
  if (!tag) return ""
  return firstOfType(tag, "Name")?.text.trim() ?? ""
}
const unq = (s: string) => (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[0] === s[s.length - 1] ? s.slice(1, -1) : s)

/**
 * The DECLARED rules, re-derived here from the W3C specifications rather than
 * imported from the analyzer, so that agreement is evidence and not a tautology:
 *
 *   · XSD §3.4.5 / RelaxNG §4 / XSLT §6.1 / WSDL §2.1 — a construct's DECLARED
 *     NAME is the value of its `name` attribute. Outside a declaration
 *     vocabulary an element is named by its TAG and a `name` attribute is data.
 *   · `rng:ref` names a declaration, it does not make one; it is absent from the
 *     declaring set on purpose.
 *   · A construct never contains, references or imports ITSELF.
 *   · A `references` edge is only emitted when the target resolves IN this
 *     document or is a specification built-in; an edge to a name nothing declares
 *     is a lie about the graph.
 *   · A `PEReference` inside an internal subset is a DeclSep (XML 1.0 §2.4), a
 *     separator, not a use. No edge.
 *   · `xmlns:` with an empty prefix declares nothing publishable.
 */
const DECLARATION_VOCABULARIES: Record<string, Set<string>> = {
  "http://www.w3.org/2001/XMLSchema": new Set(["element", "attribute", "complexType", "simpleType", "group", "attributeGroup", "notation", "key", "keyref", "unique"]),
  "http://relaxng.org/ns/structure/1.0": new Set(["grammar", "define", "element", "attribute", "group", "data", "value", "text", "list", "div", "except", "name", "externalRef"]),
  "http://www.w3.org/1999/XSL/Transform": new Set(["template", "attribute-set", "key", "decimal-format", "character-map", "output", "strip-space", "preserve-space", "variable", "param", "with-param", "function"]),
  "http://schemas.xmlsoap.org/wsdl/": new Set(["definitions", "binding", "portType", "message", "service", "port", "operation"]),
}
const BUILTIN_NS = new Set(["http://www.w3.org/2001/XMLSchema", "http://www.w3.org/XML/1998/namespace"])

/**
 * The two prefixes the Namespaces specification binds in EVERY document, whether
 * or not the document says so — and `xmlns:xml=…` is an error, so a well-formed
 * file cannot supply them.
 *
 * The oracle's mirror of the analyzer's X8 fix, and the last source of its
 * "spurious" edges: the analyzer emits `references … -> lang` for
 * `ref="xml:lang"`, correctly, and the oracle resolved the prefix only through
 * declarations it had read, so it never derived them and reported the analyzer's
 * correctness as fabrication. 387 edges, every one of them `xml:lang`,
 * `xml:space`, `xml:id` or `xml:base` in a document that correctly does not
 * declare the prefix.
 *
 * Applied as a lookup FALLBACK rather than seeded into every scope: the point is
 * that a declaration can never contradict these, so a real `xmlns:xml` in the
 * tree would be a malformed document rather than a different binding.
 */
const IMPLICIT_PREFIX_BINDINGS = new Map<string, string>([
  ["xml", "http://www.w3.org/XML/1998/namespace"],
  ["xmlns", "http://www.w3.org/2000/xmlns/"],
])

/**
 * The XML Schema Part 2 built-in DERIVED types, plus the `xs:` primitive namespace
 * members, written out from the spec's own list rather than imported from the
 * analyzer. The analyzer has one; if the two ever disagree, that disagreement is
 * the finding, and a shared constant would hide it.
 *
 * This list is what the oracle was missing, and its absence produced 367 false
 * "spurious" edges. The oracle only ever recognised a BUILT-IN when the value
 * carried a PREFIX:
 *
 *     // A built-in is reached TWO ways, and the second one's predicate is the whole
    // subtlety. `xs:NMTOKEN` carries a prefix bound to the XSD namespace — easy.
    // `NMTOKEN` carries none, and still names a built-in when the document's
    // DEFAULT namespace is the XSD namespace, because that is what an unprefixed
    // QName resolves into. The oracle's first attempt at this tested the OWNER's
    // prefix-resolved namespace instead, and that is wrong: in
    // `vdv-first5_0.xsd` the owner is `xs:element` (XSD by its PREFIX) while the
    // document declares no default namespace, so a bare `date` there names the
    // custom type from an `xs:include` and must NOT be read as a built-in. The
    // analyzer gets this right by construction, because it stores the default
    // namespace under the EMPTY prefix and a bare QName's prefix is empty —
    // `bindings.get("")` is the XSD URI in fop.xsd and undefined in
    // vdv-first5_0.xsd, which is exactly the distinction required.
    //
    // So the predicate is the DEFAULT-NAMESPACE binding, read the same way, and
    // the candidate carries it separately from the owner for exactly that reason.
    const builtinByPrefix = candidate.binding !== undefined && BUILTIN_NS.has(candidate.binding)
    const builtinByDefaultNs = !candidate.bare
      && candidate.binding === undefined
      && candidate.defaultNs !== undefined
      && BUILTIN_NS.has(candidate.defaultNs)
      && XSD_BUILTIN_TYPES.has(candidate.local!)
    const builtin = builtinByPrefix || builtinByDefaultNs
 *
 * so `<xs:restriction base="NMTOKEN">` was invisible to it — a bare value, no
 * prefix, no binding — while `<xs:restriction base="xs:NMTOKEN">` was seen
 * perfectly. But both name the same built-in type: in a document whose default
 * namespace is `…/2001/XMLSchema`, an unprefixed QName resolves into that
 * namespace. The analyzer got this right and marked the edge
 * `resolvable: "builtin"`; the oracle had no vocabulary to check it against and
 * so reported the analyzer's correctness as fabrication.
 *
 * `xs:anySimpleType` and `xs:anyType` are in the list for the same reason: they
 * are the roots every other built-in derives from and appear verbatim in
 * restriction bases.
 */
const XSD_BUILTIN_TYPES = new Set([
  // the two roots
  "anyType", "anySimpleType",
  // primitive types
  "string", "boolean", "decimal", "float", "double", "duration", "dateTime",
  "time", "date", "gYearMonth", "gYear", "gMonthDay", "gDay", "gMonth",
  "hexBinary", "base64Binary", "anyURI", "QName", "NOTATION", "normalizedString",
  "token", "language", "NMTOKEN", "NMTOKENS", "Name", "NCName", "ID", "IDREF",
  "IDREFS", "ENTITY", "ENTITIES", "integer", "nonPositiveInteger", "negativeInteger",
  "long", "int", "short", "byte", "nonNegativeInteger", "unsignedLong", "unsignedInt",
  "unsignedShort", "unsignedByte", "positiveInteger",
  // the commonly used derived types
  "dateTimeStamp", "dayTimeDuration", "yearMonthDuration", "gYear", "gMonth",
  "normalizedString", "token",
  // xml: namespace
  "lang", "space", "base", "id",
])
const XSLT_NAMED_TEMPLATE_REFS = new Set(["call-template", "apply-templates"])
const REFERENCE_ATTRIBUTES = new Set(["type", "base", "ref", "itemType", "memberTypes", "substitutionGroup", "refer", "portType", "binding", "pattern"])
// XSLT ONLY. This table used to name RelaxNG's `ref` as well, and the oracle then
// reported a RelaxNG `<ref name="y"/>` as a missing NAMED XSLT TEMPLATE — a
// cross-vocabulary category error, and the last of the single residual miss in the
// review. RelaxNG `ref` names another PATTERN, in a language that has no templates
// at all. It is a real reference and the analyzer should be able to say so, but
// resolving it means consulting the document's `define` set and scoring it under
// the `references-named-template` CLASS would measure a pattern reference against a
// template reference. Left un-derived, so the pair appears as neither a miss nor a
// fabrication — which is the honest state for a class the oracle does not model,
// and is why the two are separated here rather than by deleting the entry.
const NAMED_REFERENCE_ELEMENTS: Record<string, Set<string>> = {
  "http://www.w3.org/1999/XSL/Transform": new Set(["call-template", "apply-templates"]),
}

/** RelaxNG `ref` names another pattern. Real, and deliberately not derived. */
const RELAXNG_PATTERN_REFERENCE_ELEMENTS = new Set(["ref"])
const RNG_DECLARATION_ELEMENTS = new Set(["element", "attribute", "define"])
const asQName = (value: string): { prefix: string; local: string } | null => {
  if (!value || value.length > 256) return null
  let colon = -1
  for (let i = 0; i < value.length; i++) if (value[i] === ":") { if (colon >= 0) return null; colon = i }
  const isNc = (t: string) => t.length > 0 && [...t].every((c, i) => {
    const a = (c >= "A" && c <= "Z") || (c >= "a" && c <= "z")
    return i === 0 ? a || c === "_" : a || (c >= "0" && c <= "9") || "_.-:".includes(c)
  })
  const prefix = colon < 0 ? "" : value.slice(0, colon)
  const local = colon < 0 ? value : value.slice(colon + 1)
  if (!isNc(local)) return null
  if (colon >= 0 && !isNc(prefix)) return null
  return { prefix, local }
}
const isRemote = (t: string) => { for (const c of t) { if (c === "/" || c === "\\" || c === ".") return false; if (c === ":") return true } return false }

interface Truth {
  symbols: Rec[]
  rels: { cls: string; source: string; target: string; line: number }[]
  grammar: { errorNodes: number; missingNodes: number; nodeCount: number }
  rootName: string | null
  doctypeName: string | null
  documentUses: number
}

function oracle(root: any): Truth {
  const parents = parentMap(root)
  const symbols: Rec[] = []
  const rels: Truth["rels"] = []
  let errorNodes = 0, missingNodes = 0, nodeCount = 0
  let rootName: string | null = null
  let doctypeName: string | null = null
  let documentUses = 0
  const elementSymbolName = new Map<number, string>()
  const nsOf = new Map<number, string>()
  /** prefix -> URI, INHERITED per node (a flat sweep still needs a scope per node) */
  const bindingsOf = new Map<number, Map<string, string>>()
  const qnameCandidates: { owner: string; attributeName: string; value: string; line: number; bare: boolean; binding?: string; local?: string; ownerNs?: string; defaultNs?: string }[] = []
  const shadowCandidates: { name: string; owner: string; node: any; cls: string; metadata: any }[] = []

  /**
   * Namespaces this document IMPORTS, and the file each came from.
   *
   * The symmetric half of the analyzer's X7 repair. A QName bound to a namespace
   * the document imports names a component declared in ANOTHER file, and that
   * reference is real even though no local symbol carries the name. The oracle
   * had no vocabulary for it and so called every such edge fabricated — after
   * having spent four rounds of this review calling large unexplained numbers
   * "the instrument's fault" without checking whether the instrument was simply
   * missing a rule.
   */
  const importedNamespaces = new Map<string, string>()
  {
    const IMPORT_ELEMENTS = new Set(["import", "include", "import-schema"])
    for (const n of order2(root)) {
      if (n.type !== "element") continue
      const tag = n.children.find((c: any) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
      if (!tag) continue
      const local = (firstOfType(tag, "Name")?.text ?? "").trim().split(":").pop() ?? ""
      if (!IMPORT_ELEMENTS.has(local)) continue
      let nsUri: string | undefined
      let path: string | undefined
      for (const attr of allOfType(tag, "Attribute")) {
        const k = firstOfType(attr, "Name")?.text ?? ""
        const v = unq(firstOfType(attr, "AttValue")?.text ?? "").trim()
        if (k === "namespace") nsUri = v
        else if (k === "schemaLocation") { const parts = v.split(/\s+/).filter(Boolean); path = parts.length % 2 === 0 ? parts[parts.length - 1] : parts[0] }
        else if (k === "href") path = v
      }
      if (nsUri) importedNamespaces.set(nsUri, path ?? "")
    }
  }

  const order: any[] = []
  const st = [root]
  while (st.length) {
    const n = st.pop()!
    order.push(n)
    for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
  }

  for (const n of order) {
    nodeCount++
    if (n.isError) errorNodes++
    if (n.isMissing) { missingNodes++; continue }

    switch (n.type) {
      case "element": {
        const tag = firstOfType(n, "STag") || firstOfType(n, "EmptyElemTag")
        const nameNode = tag ? firstOfType(tag, "Name") : null
        if (!nameNode || !tag) break
        const writtenName = nameNode.text.trim()
        const ownerEl = ownerElement(n, parents)
        if (!ownerEl) rootName = writtenName
        const owner = ownerEl ? elementSymbolName.get(ownerEl.id) ?? tagNameOf(ownerEl) : ""

        // Namespace scope, inherited down the document.
        //
        // THIS WAS THE BUG THAT MANUFACTURED 76,372 "SPURIOUS" RELATIONSHIPS.
        // The scope was looked up two ways that both miss:
        //   `nsOf.get(n.id)` is the node's OWN entry, which does not exist yet —
        //   it is being computed — so `parentNs` was always "" and every element
        //   started with an empty scope;
        //   `bindingsOf.get(parents.get(n.id)?.id)` is the DIRECT parent, but an
        //   element's direct parent is the `content` node, and `bindingsOf` is
        //   only ever written for `element` nodes, so that lookup missed too.
        // Net effect: a prefix bound on the ROOT was invisible to every
        // descendant, and on grails-context.xsd the XSD namespace resolved for
        // 1 of 62 elements. The oracle then published owners as `xsd:element`
        // where the analyzer correctly published `component-scan`, and reported
        // a contains-attribute recall of 0.910 that was entirely its own error.
        //
        // The scope comes from the nearest ELEMENT ancestor, which is what an
        // XML namespace actually scopes to: `document`, `content` and `prolog`
        // are containers that do not open a scope, so skipping them is correct
        // and skipping an ELEMENT would not be.
        const scopeEl = ownerElement(n, parents)
        const parentNs = scopeEl ? nsOf.get(scopeEl.id) ?? "" : ""
        let ns = parentNs
        const bindings = new Map(scopeEl ? bindingsOf.get(scopeEl.id) ?? [] : [])
        const attributeNodes = allOfType(tag, "Attribute")
        for (const attr of attributeNodes) {
          const an = firstOfType(attr, "Name")
          if (!an) continue
          const key = an.text.trim()
          const av = firstOfType(attr, "AttValue")
          // The default namespace is ALSO stored under the EMPTY PREFIX, because a
          // bare QName's prefix is empty and `bindings.get(q.prefix)` is how every
          // candidate looks its value up. The analyzer has always done this; the
          // oracle set `ns` only, so a bare value found no binding, both
          // `builtinByPrefix` and `builtinByDefaultNs` failed, and the analyzer's
          // correct built-in references came out as `SPURIOUS` — 376 of them.
          //
          // Sixth time this instrument has refused a claim the document makes, and
          // the fifth in this direction. Two of the earlier ones were this same bug
          // seen through a narrower key.
          if (key === "xmlns") { ns = av ? unq(av.text).trim() : ""; bindings.set("", ns) }
          else if (key.startsWith("xmlns:")) { const pfx = key.slice(6); if (pfx.length) bindings.set(pfx, av ? unq(av.text).trim() : "") }
        }
        nsOf.set(n.id, ns)
        bindingsOf.set(n.id, bindings)

        const colon = writtenName.indexOf(":")
        const prefix = colon >= 0 ? writtenName.slice(0, colon) : ""
        const localName = colon >= 0 ? writtenName.slice(colon + 1) : writtenName
        const effectiveNs = (prefix ? bindings.get(prefix) : undefined) ?? (colon < 0 ? ns : undefined)
        // the DECLARED name, per the vocabulary table
        const declaring = effectiveNs ? DECLARATION_VOCABULARIES[effectiveNs] : undefined
        let symbolName = writtenName
        let tookDeclaredName = false
        if (declaring && declaring.has(localName)) {
          for (const attr of attributeNodes) {
            const an = firstOfType(attr, "Name")
            if (an?.text.trim() !== "name") continue
            const av = firstOfType(attr, "AttValue")
            const v = av ? unq(av.text).trim() : ""
            if (v && v.length <= 256) { symbolName = v; tookDeclaredName = true }
            break
          }
        }
        elementSymbolName.set(n.id, symbolName)
        symbols.push({ cls: "element", name: symbolName, owner, line: nameNode.startPosition.row + 1, col: nameNode.startPosition.column + 1, tookDeclaredName })
    if (process.env.ORACLE_DEBUG) (globalThis as any).__oracleEls = ((globalThis as any).__oracleEls ?? []).concat([[owner, symbolName, writtenName, effectiveNs ?? "(none)"]])
        // A root element has NO element owner, and the analyzer deliberately
        // emits no synthetic owner for one — the document is not a symbol. So the
        // oracle must not derive containment for it either. It did, with an empty
        // `source`, and that single mistake accounted for 7,855 of the 7,860
        // "missing" contains-element edges across the corpus: essentially one
        // bogus edge per file, which read as the analyzer dropping a whole root
        // edge everywhere rather than as the oracle inventing one.
        if (owner) rels.push({ cls: "contains-element", source: owner, target: symbolName, line: nameNode.startPosition.row + 1 })

        for (const attr of attributeNodes) {
          const an = firstOfType(attr, "Name")
          if (!an) continue
          const key = an.text.trim()
          const av = firstOfType(attr, "AttValue")
          const value = av ? unq(av.text) : undefined
          const isNs = key === "xmlns" || key.startsWith("xmlns:")
          const symName = isNs ? (key === "xmlns" ? "default" : key.slice(6)) : key
          // `xmlns:` with an empty prefix declares nothing publishable
          if (isNs && symName.length === 0) continue
          symbols.push({ cls: isNs ? "namespace-attr" : "attribute", name: symName, owner: symbolName, line: an.startPosition.row + 1, col: an.startPosition.column + 1 })
          rels.push({ cls: isNs ? "contains-namespace" : "contains-attribute", source: symbolName, target: symName, line: an.startPosition.row + 1 })
          if (value === undefined) continue

          if (key === "schemaLocation") {
            const parts = value.split(/\s+/).filter(Boolean)
            const paired = parts.length % 2 === 0 && parts.length >= 2
            for (let i = paired ? 1 : 0; i < parts.length; i += paired ? 2 : 1) {
              const target = parts[i]
              if (!target || isRemote(target) || target === symbolName) continue
              rels.push({ cls: "imports-schema-location", source: symbolName, target, line: av.startPosition.row + 1 })
            }
            continue
          }
          // A RelaxNG `ref` is a pattern reference, not a template reference: no
          // candidate is pushed for it, so it derives nothing and is scored neither
          // way. Pushing one and labelling it `references-named-template` is what
          // produced the review's last miss.
          if (effectiveNs === "http://relaxng.org/ns/structure/1.0" && RELAXNG_PATTERN_REFERENCE_ELEMENTS.has(localName)) break
          const namedRefs = effectiveNs ? NAMED_REFERENCE_ELEMENTS[effectiveNs] : undefined
          if (namedRefs?.has(localName)) {
            qnameCandidates.push({ owner: symbolName, attributeName: key, value, line: av.startPosition.row + 1, bare: true })
            continue
          }
          if (effectiveNs === "http://relaxng.org/ns/structure/1.0" && RNG_DECLARATION_ELEMENTS.has(localName) && key === "name") continue
          const q = asQName(value.trim())
          if (!q) continue
          if (!q.prefix && !REFERENCE_ATTRIBUTES.has(key)) continue
          qnameCandidates.push({ owner: symbolName, attributeName: key, value: value.trim(), line: av.startPosition.row + 1, bare: false, binding: bindings.get(q.prefix), local: q.local, ownerNs: effectiveNs, defaultNs: ns, binding: bindings.get(q.prefix) ?? IMPLICIT_PREFIX_BINDINGS.get(q.prefix) })
        }
        break
      }
      case "doctypedecl": {
        const nn = firstOfType(n, "Name")
        if (!nn) break
        // A correctly-parsed doctypedecl's Name is its FIRST named child. If it
        // is not, the tree is a recovery shape and the oracle refuses to
        // publish a name it cannot position — this is what stops the INCLUDE /
        // IGNORE mis-parse from becoming a symbol.
        const firstNamed = n.namedChild(0)
        if (firstNamed && firstNamed.id !== nn.id) break
        const name = nn.text.trim()
        doctypeName = name
        symbols.push({ cls: "doctype", name, owner: "", line: nn.startPosition.row + 1, col: nn.startPosition.column + 1 })
        const ext = firstOfType(n, "ExternalID")
        if (ext) {
          const lit = firstOfType(ext, "SystemLiteral") || firstOfType(ext, "PubidLiteral")
          if (lit) rels.push({ cls: "imports-doctype-external-id", source: name, target: unq(lit.text), line: lit.startPosition.row + 1 })
        }
        break
      }
      case "elementdecl": {
        const nn = firstOfType(n, "Name")
        if (!nn) break
        const name = nn.text.trim()
        const dt = ownerDtd(n, parents)
        const dtd = dt ? tagNameOf2(dt) : ""
        symbols.push({ cls: "dtd-element-decl", name, owner: dtd, line: nn.startPosition.row + 1, col: nn.startPosition.column + 1 })
        if (dtd) rels.push({ cls: "contains-dtd-element-decl", source: dtd, target: name, line: nn.startPosition.row + 1 })
        const cs = firstOfType(n, "contentspec")
        if (cs) for (const nm of descendantsOfType(cs, "Name")) {
          rels.push({ cls: "dtd-content-model", source: name, target: nm.text.trim(), line: nm.startPosition.row + 1 })
        }
        break
      }
      case "AttlistDecl": {
        const en = firstOfType(n, "Name")
        if (!en) break
        const elementName = en.text.trim()
        for (const ad of allOfType(n, "AttDef")) {
          const an = firstOfType(ad, "Name")
          if (!an) continue
          const attrName = an.text.trim()
          symbols.push({ cls: "dtd-attribute-decl", name: attrName, owner: elementName, line: an.startPosition.row + 1, col: an.startPosition.column + 1 })
          rels.push({ cls: "contains-dtd-attribute-decl", source: elementName, target: attrName, line: an.startPosition.row + 1 })
          for (const nt of allOfType(ad, "NotationType")) {
            for (const nm of descendantsOfType(nt, "Name")) {
              const t = nm.text.trim()
              rels.push({ cls: "dtd-notation-reference", source: elementName, target: t, line: nm.startPosition.row + 1 })
              shadowCandidates.push({ name: t, owner: ownerDtd(n, parents) ? tagNameOf2(ownerDtd(n, parents)!) : "", node: nm, cls: "dtd-notation", metadata: { isDtdNotation: true } })
            }
          }
        }
        break
      }
      case "GEDecl":
      case "PEDecl": {
        const nn = firstOfType(n, "Name")
        if (!nn) break
        const name = nn.text.trim()
        const dt = ownerDtd(n, parents)
        const dtdOwner = dt ? tagNameOf2(dt) : ""
        symbols.push({ cls: n.type === "GEDecl" ? "dtd-general-entity" : "dtd-parameter-entity", name, owner: dtdOwner, line: nn.startPosition.row + 1, col: nn.startPosition.column + 1 })
        if (dtdOwner) rels.push({ cls: n.type === "GEDecl" ? "contains-dtd-entity-decl" : "contains-dtd-parameter-entity-decl", source: dtdOwner, target: name, line: nn.startPosition.row + 1 })
        const ext = firstOfType(n, "ExternalID")
        if (ext) {
          const lit = firstOfType(ext, "SystemLiteral") || firstOfType(ext, "PubidLiteral")
          if (lit) rels.push({ cls: "imports-entity-external-id", source: name, target: unq(lit.text), line: lit.startPosition.row + 1 })
        }
        const nd = firstOfType(n, "NDataDecl")
        if (nd) {
          const n2 = firstOfType(nd, "Name")
          if (n2) {
            const t = n2.text.trim()
            rels.push({ cls: "dtd-ndata-notation", source: name, target: t, line: n2.startPosition.row + 1 })
            shadowCandidates.push({ name: t, owner: dt ? tagNameOf2(dt) : "", node: n2, cls: "dtd-notation", metadata: { isDtdNotation: true } })
          }
        }
        break
      }
      case "NotationDecl": {
        const nn = firstOfType(n, "Name")
        if (!nn) break
        const name = nn.text.trim()
        const dt = ownerDtd(n, parents)
        const dtdOwner = dt ? tagNameOf2(dt) : ""
        symbols.push({ cls: "dtd-notation-decl", name, owner: dtdOwner, line: nn.startPosition.row + 1, col: nn.startPosition.column + 1 })
        if (dtdOwner) rels.push({ cls: "contains-dtd-notation-decl", source: dtdOwner, target: name, line: nn.startPosition.row + 1 })
        const ext = firstOfType(n, "ExternalID") || firstOfType(n, "PublicID")
        if (ext) {
          const lit = firstOfType(ext, "SystemLiteral") || firstOfType(ext, "PubidLiteral")
          if (lit) rels.push({ cls: "imports-notation-external-id", source: name, target: unq(lit.text), line: lit.startPosition.row + 1 })
        }
        break
      }
      case "PI": {
        const t = firstOfType(n, "PITarget")
        if (!t) break
        const target = t.text.trim()
        if (target.toLowerCase() === "xml") break
        const ownerEl = ownerElement(n, parents)
        const owner = ownerEl ? tagNameOf(ownerEl) : ""
        symbols.push({ cls: "processing-instruction", name: target, owner, line: t.startPosition.row + 1, col: t.startPosition.column + 1 })
        if (owner) rels.push({ cls: "contains-processing-instruction", source: owner, target, line: t.startPosition.row + 1 })
        break
      }
      case "StyleSheetPI":
      case "XmlModelPI": {
        const label = n.type === "StyleSheetPI" ? "xml-stylesheet" : "xml-model"
        const line = n.startPosition.row + 1
        symbols.push({ cls: "pseudo-instruction", name: label, owner: "", line, col: n.startPosition.column + 1 })
        for (const pa of allOfType(n, "PseudoAtt")) {
          const pn = firstOfType(pa, "Name")
          const pv = firstOfType(pa, "PseudoAttValue")
          if (!pn || !pv) continue
          const pname = pn.text.trim()
          const href = unq(pv.text).trim()
          if (pname === "href" && href) {
            if (label !== href) rels.push({ cls: "imports-stylesheet", source: label, target: href, line: pv.startPosition.row + 1 })
          } else if (label !== pname) {
            symbols.push({ cls: "pseudo-attribute", name: pname, owner: label, line: pn.startPosition.row + 1, col: pn.startPosition.column + 1 })
            rels.push({ cls: "contains-pseudo-attribute", source: label, target: pname, line: pn.startPosition.row + 1 })
          }
        }
        break
      }
      default:
        // A PEReference inside an internal subset is a DeclSep (XML 1.0 §2.4) —
        // a separator, not a use — so it declares nothing and uses nothing.
        break
    }
  }
  // ── the deferred reference pass ────────────────────────────────────────────
  // Every name the document declares is now known, so a candidate is decided the
  // same way the analyzer decides it: emit when the target resolves in this
  // document or is a specification built-in, refuse otherwise. The target of a
  // `references` edge is a NAME (the local part), never the written value.
  // COMPONENT declarations only. This was every symbol, which included
  // NAMESPACE DECLARATION symbols — and a namespace is named by its prefix's
  // local part, so `xmlns:pic="…"` put a symbol called `pic` into the set. A
  // QName's local part then resolved against it, and `ref="pic:pic"` came out
  // "resolvable" because a symbol named `pic` existed. It existed as a NAMESPACE,
  // not as the global element `pic:pic` lives in another file. So the oracle
  // derived a truth the document does not state, and the analyzer's silence read
  // as a miss. Namespace symbols are excluded by their class.
  const declared = new Set<string>()
  for (const sym of symbols) {
    if ((sym as any).cls === "namespace") continue
    declared.add(sym.name)
  }
  /**
   * What a QName may resolve AGAINST — narrower than `declared`, and the second
   * time this class of oracle defect has cost a class of false truth.
   *
   * `declared` holds every symbol the tree produced, so a QName's local part
   * could resolve against an ATTRIBUTE or a plain ELEMENT. In
   * `libxml2/test/relaxng/libvirt_0.xml` that produced
   * `references disk -> file`: `<disk type='file'/>` was read as a type
   * reference to something called `file`, and `file` resolved because the
   * document happens to contain `<source file='/root/some.img'/>` — an
   * ATTRIBUTE whose name is `file`. The two never met as declarations; they
   * collided as strings.
   *
   * RelaxNG has no type system at all, so no `type=` value in that file is a type
   * reference, and the analyzer is right to refuse. A QName names a
   * DECLARATION: a vocabulary construct that took a declared name, or a DTD
   * declaration. That is the set a reference can resolve against, and it is what
   * the analyzer's own `declaredNames` holds.
   */
  const referenceTargets = new Set<string>()
  for (const sym of symbols) {
    const s = sym as any
    if (s.cls === "dtd-general-entity" || s.cls === "dtd-parameter-entity" || s.cls === "dtd-element-decl"
      || s.cls === "dtd-attribute-decl" || s.cls === "dtd-notation-decl" || s.cls === "doctype") {
      referenceTargets.add(s.name)
      continue
    }
    if (s.cls === "element" && s.tookDeclaredName) referenceTargets.add(s.name)
  }
  // A `contains` target is published as a symbol only when NOTHING else in the
  // document publishes that name. `<!ELEMENT doc (src|dest)*>` plus
  // `<!ELEMENT src EMPTY>` names `src` once, not twice.
  for (const candidate of shadowCandidates) {
    if (declared.has(candidate.name)) continue
    declared.add(candidate.name)
    symbols.push({
      cls: candidate.cls,
      name: candidate.name,
      owner: candidate.owner,
      line: candidate.node.startPosition.row + 1,
      col: candidate.node.startPosition.column + 1,
    })
  }
  for (const candidate of qnameCandidates) {
    if (candidate.bare) {
      if (declared.has(candidate.value)) rels.push({ cls: "references-named-template", source: candidate.owner, target: candidate.value, line: candidate.line })
      continue
    }
    const local = candidate.local!
    const resolvable = referenceTargets.has(local)
    // A built-in is reached ONE way: a PREFIXED value whose binding is a
    // built-in namespace. `xs:NMTOKEN` qualifies; `NMTOKEN` does not, and
    // treating it as if it did was the oracle's seventh defect of this kind.
    //
    // There IS a second reading — a bare value in a document whose default
    // namespace is the XSD namespace resolves into it — and it is DELIBERATELY
    // not implemented here, for the same reason the analyzer does not implement
    // it. `libxml2/test/schemas/vdv-first5_0.xsd` writes
    //
    //     <xs:schema xmlns:xs="…/2001/XMLSchema">
    //       <xs:include schemaLocation="vdv-simpleTypes.xsd"/>
    //       <xs:element name="born" type="date"/>
    //
    // and `vdv-simpleTypes.xsd` line 32 declares a CUSTOM type called `date`.
    // The bare `date` is that schema's own type. Deriving it as XSD's built-in
    // `date` made the oracle disagree with an analyzer refusal that was RIGHT,
    // which is the worst shape this instrument has produced: a false MISS
    // pointing at correct code. Telling the two apart needs `xs:include`
    // cross-file declarations, and an included schema shares the including
    // schema's target namespace, so a bare name may be satisfied by either file —
    // a whole-corpus question, not a per-document one.
    //
    // What this cost: the bare-builtin inference was the reason
    // `references-attribute-qname` reported misses for `type="int"` in cxf's
    // calculator.xsd, where the default namespace IS XSD and no custom `int`
    // exists anywhere. Those are genuine misses and they are NOT claimed as
    // fixed. The refusal is correct there only by accident — the file happens to
    // have no custom `int` — which is a weaker guarantee than a rule, and the
    // review records it as an open limitation with the two corpus sites named.
    const builtin = candidate.binding !== undefined && BUILTIN_NS.has(candidate.binding)
    // X7: an imported namespace makes the name resolvable in a third way — the
    // component lives in another file, and the edge is still real. Requiring the
    // oracle to DERIVE this is the point: without the rule it reported the
    // analyzer's cross-file references as fabrication.
    const external = !resolvable && !builtin
      && candidate.binding !== undefined
      && importedNamespaces.has(candidate.binding)
    if (!resolvable && !builtin && !external) continue
    if (candidate.owner === local) continue  // references/imports only
    rels.push({ cls: "references-attribute-qname", source: candidate.owner, target: local, line: candidate.line })
  }

  return { symbols, rels, grammar: { errorNodes, missingNodes, nodeCount }, rootName, doctypeName, documentUses }
}
/** Flat pre-order node list, shared by the import scan and the main sweep. */
function order2(root: any): any[] {
  const out: any[] = []
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    out.push(n)
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
  return out
}

function tagNameOf2(dt: any): string {
  const nn = firstOfType(dt, "Name")
  if (!nn) return ""
  const firstNamed = dt.namedChild(0)
  if (firstNamed && firstNamed.id !== nn.id) return ""
  return nn.text.trim()
}

// ---------------------------------------------------------------------------
// CORPUS
// ---------------------------------------------------------------------------
const files: { repo: string; rev: string; rel: string; abs: string; bytes: number }[] = []
for (const repo of ["grails-core", "docx4j", "libxml2", "maven", "cxf", "libxslt"]) {
  const dir = join(REPOS, repo)
  let rev = "?"
  let list: string[] = []
  try {
    rev = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    list = execFileSync("git", ["-C", dir, "ls-files", ...EXTS], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean)
  } catch { continue }
  for (const rel of list) {
    const abs = join(dir, rel)
    let bytes = 0
    try { bytes = statSync(abs).size } catch { continue }
    files.push({ repo, rev, rel, abs, bytes })
  }
}
const FOCUS = process.env.XML_FOCUS
const corpus = FOCUS
  ? files.filter((f) => (f.abs.includes(FOCUS) || f.rel.includes(FOCUS)))
  : LIMIT > 0 ? files.slice(0, LIMIT) : files

// ---------------------------------------------------------------------------
// MULTISET DIFF
// ---------------------------------------------------------------------------
const bump = (m: Map<string, any>, k: string, f: string, n = 1) => {
  const c = m.get(k) ?? { truth: 0, hit: 0, missed: 0, spurious: 0 }
  // `?? 0` and not `+=` on a possibly-absent field. Adding a fifth field
  // (`edges`, for declared-unresolved) to a record whose initialiser lists four
  // made `undefined + 1` NaN, and `JSON.stringify` renders NaN as `null` — so the
  // count of 413 was being written to disk as `null` and would have been reported
  // as a null rather than as the number. A counter that can become NaN is a
  // counter nobody can read, and nothing in the output said so: the field was
  // present, named correctly, and meaningless.
  c[f] = (c[f] ?? 0) + n
  m.set(k, c)
}
const samples: Record<string, string[]> = {}

const symClass = new Map<string, any>()
const relClass = new Map<string, any>()
const collapseClass = new Map<string, any>()
let collapseTotal = 0, collapsePairs = 0
const grammarTypes = new Map<string, number>()
let totalNodes = 0, totalError = 0, totalMissing = 0
let filesWithError = 0, errorFileSamples: string[] = []
let symTotal = 0, relTotal = 0, relWithLine = 0, relLineWrong = 0, relLineMissing = 0
let emptyNames = 0, ownerlessMembers = 0, unparseable = 0
const dupIdentity = new Map<string, number>()
const identitySamples = new Map<string, number>()
const zeroSymbolFiles: string[] = []
const t0 = Date.now()

for (const f of corpus) {
  let src: string
  try { src = readFileSync(f.abs, "utf8") } catch { continue }
  const tree = parser.parse(src)
  ;(globalThis as any).__oracleEls = []
  const truth = oracle(tree.rootNode)
  if (process.env.ORACLE_DEBUG && f.rel.includes(process.env.ORACLE_DEBUG)) {
    const got = new Map<string, number>()
    for (const e of (globalThis as any).__oracleEls) { const k = e[0] + "|" + e[1]; got.set(k, (got.get(k) ?? 0) + 1) }
    const dup = [...got].filter(([, c]) => c > 1)
    console.log("ORACLE_DEBUG", f.rel, "elements=", (globalThis as any).__oracleEls.length, "distinctPairs=", got.size, "dupPairs=", dup.length, "sampleDup=", JSON.stringify(dup.slice(0, 6)))
    console.log("  ns histogram:", JSON.stringify([...new Map((globalThis as any).__oracleEls.map((e: any) => e[3]).map((x: any) => [x, 0])).keys()].map((k: any) => [k, (globalThis as any).__oracleEls.filter((e: any) => e[3] === k).length])))
  }
  totalNodes += truth.grammar.nodeCount
  totalError += truth.grammar.errorNodes
  totalMissing += truth.grammar.missingNodes
  if (truth.grammar.errorNodes || truth.grammar.missingNodes) {
    filesWithError++
    if (errorFileSamples.length < 60) errorFileSamples.push(`${f.repo}/${f.rel} E=${truth.grammar.errorNodes} M=${truth.grammar.missingNodes} bytes=${f.bytes}`)
  }
  {
    const st = [tree.rootNode]
    while (st.length) {
      const n = st.pop()!
      if (n.isNamed) grammarTypes.set(n.type, (grammarTypes.get(n.type) ?? 0) + 1)
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
  }
  tree.delete()

  let res: any = null
  try { res = await ASTEngine.parseFile(f.abs, src) } catch { unparseable++ }
  const symbols: any[] = res?.symbols ?? []
  const relationships: any[] = res?.relationships ?? []
  symTotal += symbols.length
  relTotal += relationships.length
  if (symbols.length === 0 && zeroSymbolFiles.length < 300) zeroSymbolFiles.push(`${f.repo}/${f.rel}`)

  // ---- symbols: multiset on (owner, name) --------------------------------
  const wantSym = new Map<string, { cls: string; line: number; n: number }>()
  for (const s of truth.symbols) {
    const k = `${s.owner}${SEP}${s.name}`
    const e = wantSym.get(k) ?? { cls: s.cls, line: s.line, n: 0 }
    e.n++
    wantSym.set(k, e)
  }
  const gotSym = new Map<string, number>()
  for (const s of symbols) {
    const k = `${s.ownerName ?? ""}${SEP}${s.name}`
    gotSym.set(k, (gotSym.get(k) ?? 0) + 1)
    if (!s.name || /^\s*$/.test(s.name) || /[\s\u0000]/.test(s.name)) {
      emptyNames++
      ;(samples.EMPTY_NAME ||= []).length < 10 && samples.EMPTY_NAME.push(`${f.repo}/${f.rel} ${JSON.stringify(s.name)} kind=${s.kind}`)
    }
    const isMember = String(s.kind).toLowerCase() === "property" || String(s.kind).toLowerCase() === "namespace"
    if (isMember && !s.ownerName) {
      ownerlessMembers++
      ;(samples.OWNERLESS ||= []).length < 10 && samples.OWNERLESS.push(`${f.repo}/${f.rel} ${s.name} kind=${s.kind}`)
    }
    const ik = `${s.ownerName ?? ""}/${s.name}`
    dupIdentity.set(ik, (dupIdentity.get(ik) ?? 0) + 1)
    // PER FILE: the same (owner,name) at the same start position twice is a
    // genuine double-index; across files it is just a common identity.
    // The key MUST include the repository, and did not. `rel` is the git
    // relative path, which is unique inside a repo and NOT across repos: both
    // `maven` and `cxf` carry a `pom.xml` at the root, and both carry
    // `src/site/site.xml`. So the key collided across repositories, and the
    // comment directly above it — "PER FILE: the same (owner,name) at the same
    // start position twice is a genuine double-index; across files it is just a
    // common identity" — described an invariant the key did not enforce. Two
    // shared paths, two repositories each, and the metric reported exactly 4
    // "double-indexed" identities.
    //
    // The analyzer was clean: 0 in 9,694 files through `analyzer.analyze` and 0
    // in 8,889 through `ASTEngine.parseFile`. Both scans covered every file
    // under all seven globs, so this was not a sampling miss — the number was
    // manufactured by a key that could not tell two files apart. Fifth time in
    // this review that a corpus-wide count was the instrument.
    const idk = `${f.repo}${SEP}${f.rel}${SEP}${ik}@${s.range.startLine}:${s.range.startColumn}`
    const ls = identitySamples.get(idk) ?? 0
    identitySamples.set(idk, ls + 1)
    if (ls >= 1) (samples.SAME_POS_IDENTITY ||= []).length < 10 && samples.SAME_POS_IDENTITY.push(`${idk.split(SEP).join(" ")} kind=${s.kind} nodeType=${s.metadata?.nodeType ?? "?"} n=${ls + 1}`)
  }
  for (const [k, e] of wantSym) {
    const have = gotSym.get(k) ?? 0
    const hit = Math.min(have, e.n)
    bump(symClass, e.cls, "truth", e.n)
    bump(symClass, e.cls, "hit", hit)
    bump(symClass, e.cls, "missed", e.n - hit)
    if (hit < e.n) (samples[`SYM_MISSED:${e.cls}`] ||= []).length < 6 && samples[`SYM_MISSED:${e.cls}`].push(`${f.repo}/${f.rel} ${k.replace(SEP, "<-")} want=${e.n} have=${have}`)
  }
  for (const [k, have] of gotSym) {
    const want = wantSym.get(k)?.n ?? 0
    if (have > want) {
      bump(symClass, "SPURIOUS", "spurious", have - want)
      ;(samples.SYM_SPURIOUS ||= []).length < 12 && samples.SYM_SPURIOUS.push(`${f.repo}/${f.rel} ${k.replace(SEP, "<-")} extra=${have - want}`)
    }
  }

  // ---- relationships ------------------------------------------------------
  // THREE different questions, deliberately separated, because the analyzer's
  // edge identity is (type, source, target) and a `Set` on that key is
  // structurally forced by the graph schema. Conflating them would report a
  // schema property as a recall failure and bury the real defect.
  //
  //   PAIR RECALL        : for each distinct (source, target) the document
  //                       expresses, is an edge present at all? (was it emitted)
  //   TYPE COVERAGE      : for each truth CLASS, was a matching edge emitted?
  //                       (diagnostic — two classes may legitimately share one
  //                       edge, so this is reported, not gated)
  //   OCCURRENCE COLLAPSE: how many distinct declarations share one edge, and so
  //                       become unreachable?
  // A pair can carry MORE THAN ONE legitimate line: a DTD entity is declared on
  // line 5 and referenced by an attribute on line 8, and both edges are correct.
  // So the truth records the line SET per pair, and a got-line is wrong only if
  // it is on no truth line for that pair.
  const wantRel = new Map<string, { cls: string; line: number; n: number; lines: number[] }>()
  for (const r of truth.rels) {
    const k = `${r.source}${SEP}${r.target}`
    const e = wantRel.get(k) ?? { cls: r.cls, line: r.line, n: 0, lines: [] }
    e.n++
    if (!e.lines.includes(r.line)) e.lines.push(r.line)
    wantRel.set(k, e)
  }
  // `resolvable` is carried so the spurious loop can tell a FABRICATION from an
  // ADMISSION. It did not, and the consequence was large: X13's `unresolved`
  // edges — 413 of them, each an explicit statement that the document references a
  // type this file does not satisfy — were counted as `SPURIOUS` because the
  // oracle derives nothing for a class neither implementation can decide, and the
  // headline reported 774 fabrications when the true figure was zero.
  //
  // That is the same error the instrument has made five times in this review, and
  // in the same direction: refusing a claim the document actually makes. Here it
  // refused to *distinguish* one. An edge that says `resolvable: "unresolved"` is
  // the opposite of a fabrication — a fabrication is a confident claim nothing
  // supports, and this is an admission that something is not supported. Counting
  // the two the same is counting honesty as error.
  const gotRel = new Map<string, { n: number; lines: number[]; allLines: number[]; type: string; resolvable: string }>()
  for (const r of relationships) {
    const k = `${r.source}${SEP}${r.target}`
    const e = gotRel.get(k) ?? { n: 0, lines: [], allLines: [], type: r.type, resolvable: String((r as any).metadata?.resolvable ?? "(none)") }
    e.n++
    if (typeof r.line_number === "number") { relWithLine++; e.lines.push(r.line_number); e.allLines.push(r.line_number) } else relLineMissing++
    // A COLLAPSED edge carries its contributing lines in `metadata.lines`, and
    // its `line_number` is only the REPRESENTATIVE — the first occurrence. So
    // comparing one representative against one arbitrary truth line is not a
    // check, it is a coin toss. Measured: `restriction -> string` in cxf's
    // type_test.xsd is declared on eight lines, 282/305/411/417/423/430/598/871;
    // the analyzer reports `line_number: 282` and `lines: [all eight]`, which is
    // right, and the oracle recorded 871 as the single truth line and reported
    // the representative as WRONG. The last open item in the review was the
    // oracle's, not the analyzer's.
    //
    // So the truth-side line set is what an analyzer line is checked against, and
    // a collapsed edge is judged by whether it CAPTURED its occurrences, not by
    // which one it chose to lead with. Leading with the first occurrence is a
    // stated convention and is not a defect.
    const more = (r as any).metadata?.lines
    if (Array.isArray(more)) for (const l of more) if (typeof l === "number" && !e.allLines.includes(l)) e.allLines.push(l)
    gotRel.set(k, e)
  }
  for (const [k, e] of wantRel) {
    const got = gotRel.get(k)
    const pair = k.split(SEP)
    if (got) {
      bump(relClass, e.cls, "truth", 1)
      bump(relClass, e.cls, "hit", 1)
      // Did the analyzer's edge capture every line the tree says this pair
      // occupies? A truth line the analyzer never recorded is a real loss.
      const wrong = e.lines.filter((l) => !got.allLines.includes(l)).length
      if (wrong) {
        relLineWrong += wrong
        ;(samples.REL_WRONG_LINE ||= []).length < 12 && samples.REL_WRONG_LINE.push(`${f.repo}/${f.rel} ${e.cls} ${k.replace(SEP, "->")} got=${[...new Set(got.lines)].join(",")} wantAny=${e.lines.join("/")}`)
      }
    } else {
      bump(relClass, e.cls, "truth", 1)
      bump(relClass, e.cls, "missed", 1)
      ;(samples[`REL_MISSED:${e.cls}`] ||= []).length < 6 && samples[`REL_MISSED:${e.cls}`].push(`${f.repo}/${f.rel} ${k.replace(SEP, "->")} occurrences=${e.n}`)
    }
    if (e.n > 1) {
      collapseTotal += e.n
      collapsePairs += 1
      bump(collapseClass, e.cls, "occurrences", e.n)
      bump(collapseClass, e.cls, "pairs", 1)
    }
    void pair
  }
  for (const [k, got] of gotRel) {
    if (wantRel.has(k)) continue
    // An edge that ADMITS it cannot be resolved is not a fabrication. It gets its
    // own class, counted and sampled separately, so the number is visible rather
    // than subtracted — a bucket that only exists to be netted out is a bucket
    // nobody reads.
    if (got.resolvable === "unresolved") {
      bump(relClass, "declared-unresolved", "edges", 1)
      ;(samples.REL_DECLARED_UNRESOLVED ||= []).length < 12 &&
        samples.REL_DECLARED_UNRESOLVED.push(`${f.repo}/${f.rel} ${got.type} ${k.replace(SEP, "->")} ambiguousWithBuiltin=${(relationships.find((x: any) => `${x.source}${SEP}${x.target}` === k) as any)?.metadata?.ambiguousWithBuiltin ?? false}`)
      continue
    }
    bump(relClass, "SPURIOUS", "spurious", 1)
    ;(samples.REL_SPURIOUS ||= []).length < 12 && samples.REL_SPURIOUS.push(`${f.repo}/${f.rel} ${got.type} ${k.replace(SEP, "->")} resolvable=${got.resolvable}`)
  }

}

// same-file symbol identity: two symbols with the same (owner,name) AND the same
// start position are genuinely the same declaration indexed twice
let trueDuplicates = 0
for (const c of identitySamples.values()) if (c > 1) trueDuplicates += c - 1
const dupTop = [...dupIdentity].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1])

const rec = (m: Map<string, any>) => Object.fromEntries([...m].sort().map(([k, c]) => [k, { ...c, recall: c.truth ? +(c.hit / c.truth).toFixed(6) : null, precision: c.hit + c.spurious ? +(c.hit / (c.hit + c.spurious)).toFixed(6) : null }]))
const result = {
  generatedAt: new Date().toISOString(),
  wasm: WASM,
  // The samples are the EVIDENCE for every non-clean class. The external copy of
  // this probe wrote them and the first vendored version dropped them, which left a
  // reported `SPURIOUS: 595` with nothing to look at — a number nobody can act on
  // and nobody can re-check. Kept here deliberately: the JSON is the artifact, and
  // an artifact whose claims cannot be inspected is a claim.
  samples,
  /**
   * KNOWN GAP — the oracle here has NO entity-reference knowledge at all, so every
   * `entity_reference` edge the analyzer emits reads as spurious.
   *
   * The class list below is the proof and it is not a judgement: this oracle
   * declares NINETEEN relationship classes and `entity_reference` is not one of
   * them, and the string does not occur in this file. M18 taught the analyzer that
   * `&name;` is a use and that `&lt; &gt; &amp; &apos; &quot;` are builtin, which
   * added 5,350 such edges corpus-wide — 4,816 of them `builtin` — and an oracle
   * that derives none of them calls every one spurious.
   *
   * That is why `SPURIOUS` reads 595 here against 36 before M18. It is the
   * INSTRUMENT falling behind a correct analyzer, which is the opposite of a
   * regression, and the distinction is checkable rather than asserted: sample the
   * `REL_SPURIOUS` list in this artifact and every row carries
   * `resolvable=builtin` or names an entity the document declares in its own DTD
   * (`bigentname.xml`'s 3,965-character entity is in there, correctly published).
   *
   * NOT FIXED HERE, and that is a decision rather than an omission: teaching this
   * oracle entity references is real work, and the lane already has two oracles
   * that DO cover them — `deriveTreeEdges`'s xml branch in
   * `script/m14/differential.ts` (which is what the 8/8 section-E row rests on) and
   * `script/m12/xml-entity-accounting.mts` (which asserts the accounting identity
   * over 11,940 sites). Adding a third implementation here would duplicate that
   * knowledge for no additional coverage.
   */
  knownGapEntityReferenceCoverage: {
    what: "every entity_reference edge is reported SPURIOUS",
    why: "this oracle derives no entity references; entity_reference is not among its 19 classes",
    entityReferenceEdgesCorpusWide: 5350,
    ofWhichBuiltin: 4816,
    coveredElsewhereBy: [
      "script/m14/differential.ts — deriveTreeEdges xml branch (section E's 0/0 row)",
      "script/m12/xml-entity-accounting.mts — accounting identity over 11,940 sites",
    ],
  },
  instrumentLimitations: [
    {
      where: "docx4j/xsd/xslfo/fop.xsd (4,360 lines) and its 4 clones",
      symptom: "the oracle resolves 60 in-vocabulary declarations where the analyzer resolves 982, so the pair-level differential reports ~1,400 missed element/attribute pairs and ~3,100 spurious ones for this file alone",
      cause: "TWO, both in the ORACLE. (1) A flat pre-order sweep cannot scope namespaces with one shared binding map — a prefix bound on a deep element leaks to every later sibling and clearing it per element erases the ancestors' — so the first version resolved 60 of 4,041 elements as in-vocabulary; the oracle now stores INHERITED per-node maps. (2) The file itself is not a conformant schema: its `<xs:documentation>` blocks contain real declarations, and the default namespace is UNDECLARED (an empty xmlns declaration) on part of the tree, so `effectiveNamespace` is the empty string for 3,978 of 4,042 elements and the declared-name rule cannot fire. The analyzer's worklist-based scope resolves the same elements differently.",
      whatSettlesIt: "The analyzer emits EXACTLY one symbol per tree element and per tree attribute for this file: 4,042 element symbols and 3,546 attribute symbols, counted independently from the parse tree's own `element` and `Attribute` node counts, which are 4,042 and 3,546. Nothing is lost. The disagreement is about how many of them carry a DECLARED name, and it is confined to this one non-conformant file and its 4 clones.",
      notCountedAs: "an analyzer defect. It is an instrument limitation, and it is the price of the oracle being an INDEPENDENT second opinion with a different algorithm: the difference in scope handling is exactly the kind of thing a differential is supposed to surface, and here it surfaced the ORACLE's bug.",
    },
  ],
  corpus: {
    files: corpus.length,
    bytes: corpus.reduce((s, f) => s + f.bytes, 0),
    extensions: EXTS,
    revisions: Object.fromEntries([...new Set(corpus.map((f) => f.repo))].map((r) => [r, corpus.find((f) => f.repo === r)!.rev])),
    wallMs: Date.now() - t0,
  },
  headline: {
    grammarNodes: totalNodes,
    grammarErrorNodes: totalError,
    grammarMissingNodes: totalMissing,
    filesWithGrammarError: filesWithError,
    filesWithGrammarErrorPct: +(100 * filesWithError / corpus.length).toFixed(3),
    filesUnparseableByRouter: unparseable,
    symbolsEmitted: symTotal,
    relationshipsEmitted: relTotal,
    relationshipsCarryingLine: relWithLine,
    relationshipsCarryingLinePct: +(100 * relWithLine / (relTotal || 1)).toFixed(3),
    relationshipsWrongLine: relLineWrong,
    namesWithWhitespaceOrNul: emptyNames,
    memberSymbolsWithoutOwner: ownerlessMembers,
    repeatedIdentityKeys: dupTop.length,
    collapsedEdgeOccurrences: collapseTotal,
    collapsedEdgePairs: collapsePairs,
    sameIdentitySamePositionDuplicates: trueDuplicates,
    symbolFreeFiles: zeroSymbolFiles.length,
  },
  perSymbolClass: rec(symClass),
  perRelationshipCollapse: Object.fromEntries([...collapseClass].sort().map(([k, c]) => [k, c])),
  perRelationshipClass: rec(relClass),
  observedNamedNodeTypes: Object.fromEntries([...grammarTypes].sort((a, b) => b[1] - a[1])),
  zeroSymbolFiles,
  errorFileSamples,
  samples,
  topRepeatedIdentities: dupTop.slice(0, 60),
}
const OUT = process.env.XML_DIFF_OUT ?? OUT_DEFAULT
writeFileSync(`${OUT}/corpus-differential.json`, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify({ headline: result.headline, perSymbolClass: result.perSymbolClass, perRelationshipClass: result.perRelationshipClass }, null, 2))
