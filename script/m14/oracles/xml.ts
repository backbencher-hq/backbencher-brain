/**
 * XML CONTAINMENT ORACLE — the independent truth for the xml lane's `contains` label.
 *
 * Written from the XML specification's own containment rule and the DECLARATION VOCABULARIES the
 * language's schemas define (XSD, RelaxNG, XSLT, WSDL), NEVER from `real-xml-analyzer.ts`. It
 * shares no code with the analyzer: it walks the parse tree, re-derives the same symbols the
 * analyzer publishes must resolve to, and emits ONLY `contains` edges. That narrowness is
 * deliberate — the lane's own record states the audited label set is `contains` only, because an
 * oracle deriving a kind badly manufactures `unexplained` for every edge of the kinds it omits.
 * Grow the label set one PROVEN label at a time (`references` is the next candidate, 11,108
 * whole-population edges), never before its derivation is exact.
 *
 * THE CONTAINMENT RULE (XML Infoset + DTD structure): an element contains its child elements; an
 * element contains its attributes (a prefixed attribute under its LOCAL name, a namespace
 * declaration under its prefix — `xmlns` under `default`, per the analyzer's published model);
 * an element contains a processing instruction's target. The document root is the file's module.
 *
 * THE REFUSALS, encoded rather than mentioned — they make the oracle honest:
 *   - `exports` / `implements` / `instantiates` are never derived (the grammar defines no such
 *     construct; inventing truth for them would let the differential certify a fiction).
 *   - `references` / `calls` / `extends` / `overrides` / `uses` / `imports` are never derived here
 *     (this oracle is `contains`-only by plan; each joins later only when proven).
 *   - an empty target is never pushed (a namespace declaration with no written prefix has no name
 *     to point at and is refused, not published).
 *   - the `xml`-prefixed pseudo-instructions and the XML declaration are not PIs (the grammar turns
 *     them into XMLDecl/StyleSheetPI/XmlModelPI; only a real `PI` with a PITarget is contained).
 */

/** The declaration vocabularies: namespaces whose elements carry their declared name in an attribute. */
const DECLARATION_VOCABULARIES: Record<string, ReadonlySet<string>> = {
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

function findDirectChild(node: any, type: string): any | null {
  for (let i = 0; i < (node.namedChildCount ?? 0); i++) {
    const c = node.namedChild(i)
    if (c?.type === type) return c
  }
  return null
}

function attrOf(tagNode: any, wanted: string): string | null {
  for (let i = 0; i < (tagNode.namedChildCount ?? 0); i++) {
    const a = tagNode.namedChild(i)
    if (a?.type !== "Attribute") continue
    const nameNode = findDirectChild(a, "Name")
    if (nameNode?.text.trim() !== wanted) continue
    const valueNode = findDirectChild(a, "AttValue")
    if (!valueNode) return null
    return valueNode.text.replace(/^["']|["']$/g, "")
  }
  return null
}

export function deriveXmlTruth(root: any, moduleName: string): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    if (!from || !target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }

  const walk = (node: any, owner: string, bindings: Map<string, string>, documentLevel = false) => {
    for (let i = 0; i < (node.namedChildCount ?? 0); i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "element") {
        const tagNode = findDirectChild(child, "STag") ?? findDirectChild(child, "EmptyElemTag")
        const nameNode = tagNode ? findDirectChild(tagNode, "Name") : null
        const name = nameNode?.text.trim()
        if (name && tagNode) {
          // Namespace bindings this element writes, scoped to its own subtree.
          const scoped = new Map(bindings)
          for (let j = 0; j < (tagNode.namedChildCount ?? 0); j++) {
            const a = tagNode.namedChild(j)
            if (a?.type !== "Attribute") continue
            const an = findDirectChild(a, "Name")?.text.trim() ?? ""
            if (an !== "xmlns" && !an.startsWith("xmlns:")) continue
            const v = attrOf(tagNode, an)
            if (v === null) continue
            scoped.set(an === "xmlns" ? "" : an.slice(6), v)
          }
          // The written name's prefix decides which namespace is in scope, and the
          // declaration vocabularies put the DECLARED name in the `name` attribute.
          const colon = name.indexOf(":")
          const prefix = colon >= 0 ? name.slice(0, colon) : ""
          const localName = colon >= 0 ? name.slice(colon + 1) : name
          const effectiveNamespace = scoped.get(prefix) ?? (colon < 0 ? scoped.get("") : undefined)
          const declaring = effectiveNamespace ? DECLARATION_VOCABULARIES[effectiveNamespace] : undefined
          const declaredName = declaring?.has(localName) ? attrOf(tagNode, "name") : null
          const symbolName = declaredName ?? name
          // DOCUMENT LEVEL: the lane's relation starts at elements, so the root element is
          // contained by nothing this label derives (see the header note).
          if (!documentLevel) push("contains", owner, symbolName)
          // Attributes: a namespace declaration contains its prefix (`default` for `xmlns`);
          // every other attribute is contained under its LOCAL name.
          for (let j = 0; j < (tagNode.namedChildCount ?? 0); j++) {
            const a = tagNode.namedChild(j)
            if (a?.type !== "Attribute") continue
            const an = findDirectChild(a, "Name")?.text.trim() ?? ""
            if (!an) continue
            if (an === "xmlns") { push("contains", symbolName, "default"); continue }
            if (an.startsWith("xmlns:")) {
              const p = an.slice(6)
              if (p.length > 0) push("contains", symbolName, p)
              continue
            }
            const ai = an.indexOf(":")
            push("contains", symbolName, ai >= 0 ? an.slice(ai + 1) : an)
          }
          walk(child, symbolName, scoped, false)
          continue
        }
      }
      if (child.type === "PI") {
        const targetNode = findDirectChild(child, "PITarget")
        const target = targetNode?.text.trim()
        // A PI at document level has no element owner in the lane's model (the analyzer's PI
        // contains requires an owner element), so it derives nothing there.
        if (!documentLevel && target && target.toLowerCase() !== "xml") push("contains", owner, target)
        continue
      }
      walk(child, owner, bindings, documentLevel)
    }
  }

  walk(root, moduleName, new Map(), true)
  return edges
}
