/**
 * EXTENDED-TYPES CENSUS — decorates / mixes_in / renders candidate constructs, measured
 * over the WHOLE admitted population, with the analyzer's CURRENT emission for each
 * candidate so a ruling can say "already emitted as X" or "emits nothing" rather than guess.
 *
 * ## WHY THE ANALYZER'S OWN EMISSION IS ON EVERY ROW
 *
 * A ruling has to answer two questions: does the CONSTRUCT exist in the corpus (a count),
 * and what does the analyzer do with it TODAY (the label). The java lane's exclusion
 * prose answered only the first; the second is what decides whether a type is a GAP (the
 * construct exists and the analyzer emits nothing) or a RELABEL (the construct exists and
 * carries the wrong label) or a RULING (no construct exists).
 *
 * ## THE POPULATION
 *
 * Every git repository under the corpus root, `git ls-files` tracked only, <= 512 KiB,
 * with an extension the ROUTER gives this lane (.xml .xsd .dtd .svg .xsl .xslt .rng).
 * `.corpus/<repo>` entries are SYMLINKS, so the walk `stat`s each entry (following the link).
 *
 * ## RUN
 *   BB_CORPUS_ROOT=$PWD/.corpus npx tsx validation/m14/fixtures/xml/extended-types-census.mts
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

const ROOT = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const EXTS = new Set(["xml", "xsd", "dtd", "svg", "xsl", "xslt", "rng"])
const CAP = 512 * 1024

const XSLT_NS = "http://www.w3.org/1999/XSL/Transform"
const XSD_NS = "http://www.w3.org/2001/XMLSchema"
const RNG_NS = "http://relaxng.org/ns/structure/1.0"
const SVG_NS = "http://www.w3.org/2000/svg"

/** Candidate screen: any of the candidate constructs, text-level (superset of parse-level). */
function isCandidate(text: string): boolean {
  if (/\bonClick\s*=|onLongClick\s*=|\belement\s*=\s*["']\{/i.test(text)) return true          // decorates
  if (/substitutionGroup\s*=|attributeGroup|combine\s*=|use-attribute-sets|<xs:group|redefine/i.test(text)) return true // mixes_in
  if (/<\s*(?:[\w.-]+:)?use\b|apply-templates|call-template|value-of/i.test(text)) return true  // renders
  return false
}

type Bucket = {
  describes: string
  sites: number
  files: Set<string>
  examples: { file: string; line: number; detail: string }[]
  /** What the analyzer emits at these sites today, counted on the same files. */
  analyzerToday: Record<string, number>
}

const buckets: Record<string, Bucket> = {
  // ── decorates: the CALLABILITY test — does an attribute value name something that RUNS? ──
  deco_android_event_handler: {
    describes: "android:onClick / android:onLongClick (and kin) — an event handler METHOD NAME in an attribute value; the method is declared in Java, outside any XML document",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  deco_generic_onclick: {
    describes: "onclick= / onClick= outside the android namespace — HTML-in-XML event handler spellings",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  deco_xslt_element_factory: {
    describes: "xsl:element element= — an AVT naming the output element; a template, not a callable applied to a declaration",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  deco_pi_target: {
    describes: "a processing instruction whose pseudo-attribute names a stylesheet (xml-stylesheet href) — already `imports`",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },

  // ── mixes_in: COMPOSE a named reusable definition into another, neither extends nor implements ──
  mix_xsd_substitution_group: {
    describes: "XSD substitutionGroup= (§4.6) — element substitution membership; the TYPE-level relation it requires is already `extends` via derivation",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  mix_xsd_attributegroup_ref: {
    describes: "XSD <xs:attributeGroup ref=\"G\"> inside a complexType/attributeGroup — composes G's attribute bundle into THIS definition: no base, no conformance",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  mix_xsd_group_ref: {
    describes: "XSD <xs:group ref=\"G\"> inside a complexType — composes G's content model into THIS type: no base, no conformance",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  mix_xsd_redefine: {
    describes: "XSD <xs:redefine schemaLocation=…> — inclusion-with-redefinition, a merge channel",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  mix_xslt_use_attribute_sets: {
    describes: "XSLT 1.0 §7.1.4 use-attribute-sets=\"a b\" — composes named attribute-set DEFINITIONS into this element: no base, no conformance",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  mix_rng_combine: {
    describes: "RELAX NG <define name=X combine=\"choice\"> — merges this definition with another definition of X",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },

  // ── renders: a COMPONENT rendering a COMPONENT ──
  ren_svg_use: {
    describes: "SVG <use xlink:href=\"#x\"> / href=\"#x\" — renders a referenced graphic component at this point, in-document",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  ren_xslt_call_template: {
    describes: "xsl:call-template name=X — invokes a named template (already `calls`, 402 edges)",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  ren_xslt_apply_templates: {
    describes: "xsl:apply-templates — template DISPATCH by match, names no component",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
  ren_xslt_value_of: {
    describes: "xsl:value-of select= — an XPath VALUE read, not a component",
    sites: 0, files: new Set(), examples: [], analyzerToday: {},
  },
}

async function main() {
  const repos: string[] = []
  for (const entry of readdirSync(ROOT)) {
    const p = path.join(ROOT, entry)
    let st
    try { st = statSync(p) } catch { continue }
    if (!st.isDirectory()) continue
    try { statSync(path.join(p, ".git")); repos.push(entry) } catch { /* not a repo root */ }
  }

  const candidates: { repo: string; rel: string; abs: string }[] = []
  let admitted = 0
  for (const repo of repos) {
    let files: string[]
    try {
      files = execSync(`git -C ${JSON.stringify(path.join(ROOT, repo))} ls-files`, {
        encoding: "utf8", maxBuffer: 1 << 28,
      }).split("\n").map((s) => s.trim()).filter(Boolean)
    } catch { continue }
    for (const rel of files) {
      const ext = rel.slice(rel.lastIndexOf(".") + 1)
      if (!EXTS.has(ext)) continue
      const abs = path.join(ROOT, repo, rel)
      let st
      try { st = statSync(abs) } catch { continue }
      if (!st.isFile() || st.size > CAP) continue
      admitted++
      let text: string
      try { text = readFileSync(abs, "utf8") } catch { continue }
      if (isCandidate(text)) candidates.push({ repo, rel, abs })
    }
  }

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const { RealXmlAnalyzer } = await import("../../../../src/ast/real-xml-analyzer")

  let parsed = 0
  for (const cand of candidates) {
    let text: string
    try { text = readFileSync(cand.abs, "utf8") } catch { continue }
    const tree = parser.parse(text)
    if (!tree) continue
    parsed++

    // ── classify this document's elements against the candidate buckets ──────
    const bindings = new Map<string, string>([["xml", "http://www.w3.org/XML/1998/namespace"]])
    const hitHere: Record<string, { line: number; detail: string }[]> = {}
    const visit = (node: any) => {
      if (node.type === "element") {
        const tag = node.children?.find((c: any) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
        const nameNode = tag?.children?.find((c: any) => c?.type === "Name")
        const written = nameNode?.text?.trim() ?? ""
        const colon = written.indexOf(":")
        const prefix = colon >= 0 ? written.slice(0, colon) : ""
        const local = colon >= 0 ? written.slice(colon + 1) : written
        const added: [string, string | undefined][] = []
        const attrs: Record<string, string> = {}
        if (tag) {
          for (let i = 0; i < tag.namedChildCount; i++) {
            const attr = tag.namedChild(i)
            if (attr?.type !== "Attribute") continue
            const an = attr.children?.find((c: any) => c?.type === "Name")?.text?.trim() ?? ""
            const av = attr.children?.find((c: any) => c?.type === "AttValue")?.text?.trim() ?? ""
            const value = av.length >= 2 && (av[0] === '"' || av[0] === "'") ? av.slice(1, -1) : av
            attrs[an] = value
            if (an === "xmlns") { added.push(["", bindings.get("")]); bindings.set("", value) }
            else if (an.startsWith("xmlns:")) { const p = an.slice(6); added.push([p, bindings.get(p)]); bindings.set(p, value) }
          }
        }
        const ns = bindings.get(prefix) ?? (colon < 0 ? bindings.get("") : undefined) ?? null
        const line = (tag ?? node).startPosition.row + 1

        const push = (bucket: string, detail: string) => {
          ;(hitHere[bucket] ??= []).push({ line, detail })
        }
        // decorates
        if (/^on[A-Z]/.test(local) && local.toLowerCase().includes("click") && ns && ns.includes("android")) {
          push("deco_android_event_handler", `${written}=${JSON.stringify(attrs[written] ?? attrs[local] ?? "")}`)
        }
        if ((local === "onClick" || local === "onclick") && (!ns || !ns.includes("android"))) {
          push("deco_generic_onclick", `${written}=${JSON.stringify(attrs[written] ?? attrs[local] ?? "")}`)
        }
        if (ns === XSLT_NS && local === "element" && "element" in attrs) {
          push("deco_xslt_element_factory", `element=${JSON.stringify(attrs["element"])}`)
        }
        if (ns === XSLT_NS && (local === "stylesheet" || local === "transform") && Object.keys(attrs).some((a) => a.startsWith("xml-"))) {
          // xml-stylesheet PI is a PI, not an element; this bucket is filled below from PI nodes
        }
        // mixes_in
        if (ns === XSD_NS && "substitutionGroup" in attrs) {
          push("mix_xsd_substitution_group", `substitutionGroup=${JSON.stringify(attrs["substitutionGroup"])}`)
        }
        if (ns === XSD_NS && local === "attributeGroup" && "ref" in attrs) {
          push("mix_xsd_attributegroup_ref", `ref=${JSON.stringify(attrs["ref"])}`)
        }
        if (ns === XSD_NS && local === "group" && "ref" in attrs) {
          push("mix_xsd_group_ref", `ref=${JSON.stringify(attrs["ref"])}`)
        }
        if (ns === XSD_NS && local === "redefine" && "schemaLocation" in attrs) {
          push("mix_xsd_redefine", `schemaLocation=${JSON.stringify(attrs["schemaLocation"])}`)
        }
        if (ns === XSLT_NS && "use-attribute-sets" in attrs) {
          push("mix_xslt_use_attribute_sets", `use-attribute-sets=${JSON.stringify(attrs["use-attribute-sets"])}`)
        }
        if (ns === RNG_NS && local === "define" && "combine" in attrs) {
          push("mix_rng_combine", `name=${JSON.stringify(attrs["name"] ?? "")} combine=${JSON.stringify(attrs["combine"])}`)
        }
        // renders
        if (ns === SVG_NS && local === "use") {
          const href = attrs["xlink:href"] ?? attrs["href"] ?? ""
          push("ren_svg_use", `href=${JSON.stringify(href)}`)
        }
        if (ns === XSLT_NS && local === "call-template" && "name" in attrs) {
          push("ren_xslt_call_template", `name=${JSON.stringify(attrs["name"])}`)
        }
        if (ns === XSLT_NS && local === "apply-templates") {
          push("ren_xslt_apply_templates", `select=${JSON.stringify(attrs["select"] ?? "")}`)
        }
        if (ns === XSLT_NS && local === "value-of" && "select" in attrs) {
          push("ren_xslt_value_of", `select=${JSON.stringify(attrs["select"])}`)
        }

        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.type !== "STag" && c.type !== "EmptyElemTag" && c.type !== "ETag") visit(c)
        }
        for (const [k, prev] of added.reverse()) {
          if (prev === undefined) bindings.delete(k)
          else bindings.set(k, prev)
        }
        return
      }
      if (node.type === "PI" || node.type === "StyleSheetPI" || node.type === "XmlModelPI") {
        const target = node.children?.find((c: any) => c?.type === "PITarget")?.text?.trim()
          ?? node.children?.find((c: any) => c?.type === "Name")?.text?.trim() ?? ""
        if (target === "xml-stylesheet") {
          const line = node.startPosition.row + 1
          ;(hitHere["deco_pi_target"] ??= []).push({ line, detail: node.text.slice(0, 90) })
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(tree.rootNode)

    // ── what the analyzer emits for THIS file today ─────────────────────────
    const result = new RealXmlAnalyzer().analyze(tree.rootNode, text, `${cand.repo}/${cand.rel}`)
    const rels = result.relationships ?? []
    const todayCounts: Record<string, number> = {}
    for (const r of rels) {
      const role = String((r.metadata as any)?.role ?? "")
      const occ = Number((r.metadata as any)?.occurrences ?? 1)
      const key = `${r.type}:${role}`
      todayCounts[key] = (todayCounts[key] ?? 0) + occ
    }

    for (const [bucketName, hits] of Object.entries(hitHere)) {
      const b = buckets[bucketName]
      b.sites += hits.length
      b.files.add(`${cand.repo}/${cand.rel}`)
      for (const h of hits.slice(0, 3)) {
        if (b.examples.length < 5) b.examples.push({ file: `${cand.repo}/${cand.rel}`, line: h.line, detail: h.detail })
      }
      // attribute the analyzer's emissions on a file that carries the construct: the top
      // roles on this file, so a ruling can see what label the construct carries today.
      for (const [key, n] of Object.entries(todayCounts)) {
        b.analyzerToday[key] = (b.analyzerToday[key] ?? 0) + n
      }
    }
    if (typeof (tree as any).delete === "function") (tree as any).delete()
  }

  const out = {
    instrument: "validation/m14/fixtures/xml/extended-types-census.mts",
    population: {
      root: ROOT, repos: repos.length, admitted,
      admission: "git-tracked, <= 512 KiB, extension in the router's set (.xml .xsd .dtd .svg .xsl .xslt .rng)",
      candidatesScreened: candidates.length, candidatesParsed: parsed,
    },
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, b]) => [k, {
      describes: b.describes,
      sites: b.sites,
      files: b.files.size,
      examples: b.examples,
      analyzerToday: b.analyzerToday,
    }])),
  }
  console.log(JSON.stringify(out, null, 2))
  writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "extended-types-census.json"), JSON.stringify(out, null, 2) + "\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
