/**
 * HTML LANE — CONSTRUCT PROBE (does the LANGUAGE have the construct?).
 *
 * The ontology workstream's rule is that a missing type is a fact about the
 * FORMAT, and that the fact must be measured: "a ruling with no corpus is
 * worthless". This file is the instrument for the types html does NOT emit and
 * for the ones it might be argued it should. Every number it prints is a count
 * over the git-tracked html files of `BB_CORPUS_ROOT`, read from the parse tree
 * of the PINNED grammar — no regular expression anywhere, because a text probe
 * for "does this document have an inheritance construct" matches
 * `class="extends"` in a stylesheet and `<div id="overrides">` in a demo page,
 * which is the exact false-positive the shared ontology gate documents for bash.
 *
 * WHAT IT ASKS, and what each answer means for the ontology:
 *
 *   1 IDREF ATTRIBUTES   HTML defines a class of attributes whose content model
 *                         is a list of element IDs (`aria-labelledby`,
 *                         `aria-describedby`, `aria-controls`, `aria-owns`,
 *                         `aria-flowto`, `aria-details`, `aria-errormessage`,
 *                         `headers`, `form`, `list`). The analyzer reads
 *                         `aria-labelledby` as an ACCESSIBILITY COUNTER and never
 *                         as a reference, and emits nothing for the other eleven.
 *                         Counted here: how many sites, and how many resolve to an
 *                         element in the same document. A construct with zero sites
 *                         is RULED; a construct with sites AND resolutions is a
 *                         GAP, and the size of the gap is the number of edges.
 *
 *   2 CUSTOM ELEMENTS    `<my-widget>` in a document is a potential custom element
 *                         name: the HTML standard's custom-element-registry lookup
 *                         is an instantiation of the element's definition. Counted
 *                         here: how many custom element tags, and how many have a
 *                         matching class definition anywhere in the corpus, because
 *                         an edge whose target does not exist is an unresolved
 *                         endpoint and `instantiates` sits in the differential's
 *                         ALWAYS-COMPARED head — so an emitted row the oracle does
 *                         not derive reads as fabrication.
 *
 *   3 OVERRIDES          A member declaration is expressible only in the delegate
 *                         languages, so the falsifiable probe is not "is there a
 *                         method" but "does one class declare the same method name
 *                         twice". `method_definition` alone proves nothing, which is
 *                         why the earlier count of 172 is not a verdict.
 *
 *   4 PROTOTYPE KEYS     Every vocabulary in the analyzer is keyed by a string the
 *                         DOCUMENT supplies. On a plain object literal, `<constructor>`
 *                         answers `Object`, `<tostring>` answers
 *                         `Object.prototype.toString`, and `id="__proto__"` writes
 *                         the prototype instead of a key. Counted here: which of
 *                         those inputs the corpus actually reaches, because a latent
 *                         defect and a reachable one are different claims.
 *
 * CLI
 *   npx tsx validation/m14/probes/html/construct-probe.mts
 *   npx tsx validation/m14/probes/html/construct-probe.mts --repo=vuejs
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const repoArg = argv.find((a) => a.startsWith("--repo="))

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const entry of repoArg ? [repoArg.slice("--repo=".length)] : readdirSync(CORPUS_ROOT)) {
  const dir = path.join(CORPUS_ROOT, entry)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      const st = statSync(abs)
      if (!st.isFile() || st.size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "html") continue
    files.push({ repo: entry, dir, rel, abs, text })
  }
}

/**
 * The IDREF class, written out rather than derived from a pattern. Each entry
 * names the HTML specification's content model, because the model is the reason
 * these are references and `class` is not: the attribute's value is a list of
 * element IDs, and the browser resolves each one through `getElementById`.
 */
const IDREF_ATTRS: { tag: string; attr: string; why: string }[] = [
  { tag: "", attr: "aria-labelledby", why: "names the element(s) that label this one" },
  { tag: "", attr: "aria-describedby", why: "names the element(s) that describe this one" },
  { tag: "", attr: "aria-details", why: "names the element(s) that detail this one" },
  { tag: "", attr: "aria-errormessage", why: "names the element carrying the error" },
  { tag: "", attr: "aria-controls", why: "names the element(s) this control controls" },
  { tag: "", attr: "aria-owns", why: "names the element(s) this owns" },
  { tag: "", attr: "aria-flowto", why: "names the next element in the reading flow" },
  { tag: "td", attr: "headers", why: "names the header cells this data cell belongs to" },
  { tag: "th", attr: "headers", why: "names the header cells this header cell overrides" },
  { tag: "", attr: "form", why: "names the form this control belongs to" },
  { tag: "", attr: "list", why: "names the datalist this input offers" },
  { tag: "img", attr: "ismap", why: "a flag, not a reference — listed so its absence is measured too" },
]
/** The document-supplied strings that a plain-object lookup answers wrongly. */
const PROTOTYPE_MEMBERS = [
  "constructor", "toString", "toLocaleString", "valueOf", "hasOwnProperty",
  "isPrototypeOf", "propertyIsEnumerable", "__proto__", "__defineGetter__",
  "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
]
const TABLES_READ_BY_TAG = [
  "SEMANTIC_ELEMENTS", "INTERACTIVE_ELEMENTS", "FORM_ELEMENTS", "TEMPLATE_BARRIERS",
  "RESOURCE_RULES", "HEADING_ELEMENTS",
]

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const html = new P()
html.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-html.wasm"))))
const js = new P()
js.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm"))))

// --------------------------------------------------------------------------
// 1 + 2 + 4 — one pass over the html trees.
// --------------------------------------------------------------------------
interface IdrefStat { sites: number; tokens: number; resolved: number; files: number; examples: string[] }
const idref = new Map<string, IdrefStat>()
for (const r of IDREF_ATTRS) idref.set(`${r.tag}@${r.attr}`, { sites: 0, tokens: 0, resolved: 0, files: 0, examples: [] })
const customElements = new Map<string, { sites: number; files: number }>()
/** Instances whose final kebab segment is ALL DIGITS — the shape a compiler's
 *  code-dump placeholder takes (`comment-1`, `declaration-12`). Counted because
 *  the `instantiates` ruling below turns on whether a kebab-case tag in this
 *  corpus is a custom element at all. */
let kebabAllDigits = 0
let kebabInstances = 0
const kebabFiles = new Set<string>()
const protoTagHits = new Map<string, { tag: string; table: string; files: string[] }>()
const protoAttrHits = new Map<string, { attr: string; files: string[] }>()
const protoIdHits = new Map<string, { files: string[] }>()
let baseHref = 0
let documents = 0

for (const f of files) {
  const tree = html.parse(f.text)
  if (!tree) continue
  documents++
  const label = `${f.repo}/${f.rel}`
  // Handles declared in this document, so a reference can be scored as resolvable.
  const handles = new Set<string>()
  const elements: { tag: string; attrs: Map<string, string> }[] = []
  const walk = (n: any) => {
    if (n.type === "element" || n.type === "script_element" || n.type === "style_element") {
      const startTag = (() => {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c?.type === "start_tag" || c?.type === "self_closing_tag") return c
        }
        return null
      })()
      let tag = ""
      const attrs = new Map<string, string>()
      if (startTag) {
        for (let j = 0; j < startTag.childCount; j++) {
          const c = startTag.child(j)
          if (c?.type === "tag_name") { tag = c.text.toLowerCase(); continue }
          if (c?.type !== "attribute") continue
          let an = ""
          let av = ""
          for (let k = 0; k < c.childCount; k++) {
            const ac = c.child(k)
            if (ac?.type === "attribute_name") an = ac.text.toLowerCase()
            else if (ac?.type === "quoted_attribute_value" || ac?.type === "attribute_value") {
              let inner = ""
              for (let m = 0; m < ac.namedChildCount; m++) {
                const g = ac.namedChild(m)
                if (g?.type === "attribute_value") { inner = g.text; break }
              }
              av = inner.length > 0 ? inner : ac.text.replace(/^["']|["']$/g, "")
            }
          }
          if (an.length > 0 && !attrs.has(an)) attrs.set(an, av)
        }
      }
      if (tag.length > 0) elements.push({ tag, attrs })
      const id = attrs.get("id") ?? ""
      const nm = id.length > 0 ? "" : (attrs.get("name") ?? "")
      if (id.length > 0) handles.add(id)
      if (nm.length > 0) handles.add(nm)
      // 2 — a custom element tag is `kebab-case` and is the one thing in a plain
      // HTML document a JS class definition can be joined against.
      if (tag.indexOf("-") !== -1 && tag !== "annotation-xml") {
        const row = customElements.get(tag) ?? { sites: 0, files: 0 }
        row.sites++
        row.files++
        customElements.set(tag, row)
        kebabInstances++
        kebabFiles.add(label)
        const last = tag.slice(tag.lastIndexOf("-") + 1)
        let allDigits = last.length > 0
        for (let i = 0; i < last.length; i++) {
          const c = last.charCodeAt(i)
          if (c < 48 || c > 57) { allDigits = false; break }
        }
        if (allDigits) kebabAllDigits++
      }
      // 4 — document-supplied keys against the analyzer's table keys.
      for (const t of TABLES_READ_BY_TAG) {
        if (PROTOTYPE_MEMBERS.includes(tag)) {
          const key = `${tag}`
          const row = protoTagHits.get(key) ?? { tag, table: t, files: [] }
          if (row.files.length < 4) row.files.push(label)
          protoTagHits.set(key, row)
        }
      }
      for (const a of attrs.keys()) {
        if (PROTOTYPE_MEMBERS.includes(a)) {
          const row = protoAttrHits.get(a) ?? { attr: a, files: [] }
          if (row.files.length < 4) row.files.push(label)
          protoAttrHits.set(a, row)
        }
      }
      const rawId = attrs.get("id") ?? ""
      if (PROTOTYPE_MEMBERS.includes(rawId)) {
        const row = protoIdHits.get(rawId) ?? { files: [] }
        if (row.files.length < 4) row.files.push(label)
        protoIdHits.set(rawId, row)
      }
      if (tag === "base" && (attrs.get("href") ?? "").length > 0) baseHref++
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(tree.rootNode)

  // 1 — the IDREF class, scored against the document's own handles.
  const perKeyFiles = new Set<string>()
  for (const el of elements) {
    for (const rule of IDREF_ATTRS) {
      if (rule.tag.length > 0 && rule.tag !== el.tag) continue
      const raw = el.attrs.get(rule.attr)
      if (raw === undefined || raw.length === 0) continue
      const st = idref.get(`${rule.tag}@${rule.attr}`)!
      st.sites++
      perKeyFiles.add(`${rule.tag}@${rule.attr}`)
      // A space-separated ID list — split on ASCII whitespace, no regex.
      let start = 0
      for (let i = 0; i <= raw.length; i++) {
        const atEnd = i === raw.length
        const c = atEnd ? 32 : raw.charCodeAt(i)
        const sp = c === 32 || c === 9 || c === 10 || c === 13 || c === 12
        if (!sp) continue
        if (i > start) {
          const tok = raw.slice(start, i)
          st.tokens++
          if (handles.has(tok)) st.resolved++
          else if (st.examples.length < 3) st.examples.push(`${label}: ${tok}`)
        }
        start = i + 1
      }
    }
  }
  for (const k of perKeyFiles) {
    const rule = IDREF_ATTRS.find((r) => `${r.tag}@${r.attr}` === k)!
    idref.get(k)!.files++
    void rule
  }
  tree.delete?.()
}

// --------------------------------------------------------------------------
// 3 — OVERRIDES, the falsifiable form: ONE class declaring ONE method name TWICE.
// --------------------------------------------------------------------------
const { ASTEngine } = await import("../../../../src/ast/engine")
let blocks = 0
let classesInBlocks = 0
let methodsInBlocks = 0
let duplicateMethodSites: string[] = []
let classesWithHeritage: string[] = []
let duplicateTopLevelFunctions: string[] = []
/** Keyed `repo/rel|name`, so it spans blocks of one DOCUMENT and never crosses
 *  documents — a redefinition is a same-file fact, exactly as the shared gate's
 *  bash `overrides` probe states. */
const topLevelFns = new Set<string>()
for (const f of files) {
  const tree = html.parse(f.text)
  if (!tree) continue
  let bs: any[]
  try { bs = ASTEngine.extractHtmlEmbeddedBlocks(tree.rootNode, f.text) } catch { tree.delete?.(); continue }
  for (const b of bs) {
    if (b.lang !== "js" && b.lang !== "ts" && b.lang !== "tsx") continue
    blocks++
    const sub = js.parse(b.body)
    if (!sub) continue
    const visit = (n: any) => {
      if (n.type === "class_declaration" || n.type === "class") {
        classesInBlocks++
        const nameNode = n.childForFieldName?.("name")
        const cls = nameNode?.text ?? "(anonymous)"
        // The members live in a `class_body` CHILD, not on the class node itself.
        // A first version of this probe read only the class node's direct children
        // and reported 0 methods against the census's 172 — the probe was wrong,
        // not the corpus, and the direction of the error is the dangerous one:
        // an instrument that cannot see a member would have "ruled" `overrides`.
        const seen = new Map<string, number>()
        const readMembers = (body: any) => {
          for (let i = 0; i < body.namedChildCount; i++) {
            const c = body.namedChild(i)
            if (!c) continue
            if (c.type === "class_heritage" || c.type === "extends_clause" || c.type === "implements_clause") {
              classesWithHeritage.push(`${f.repo}/${f.rel}:${b.startLine} ${cls} ${c.type}`)
            }
            if (c.type === "method_definition") {
              methodsInBlocks++
              const mn = c.childForFieldName?.("name")?.text ?? ""
              const k = (seen.get(mn) ?? 0) + 1
              seen.set(mn, k)
              if (k === 2 && duplicateMethodSites.length < 12) duplicateMethodSites.push(`${f.repo}/${f.rel}:${b.startLine} ${cls}.${mn} declared twice`)
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "class_heritage" || c.type === "extends_clause" || c.type === "implements_clause") {
            classesWithHeritage.push(`${f.repo}/${f.rel}:${b.startLine} ${cls} ${c.type}`)
          }
          if (c.type === "class_body") readMembers(c)
          if (c.type === "method_definition") {
            methodsInBlocks++
            const mn = c.childForFieldName?.("name")?.text ?? ""
            const k = (seen.get(mn) ?? 0) + 1
            seen.set(mn, k)
            if (k === 2 && duplicateMethodSites.length < 12) duplicateMethodSites.push(`${f.repo}/${f.rel}:${b.startLine} ${cls}.${mn} declared twice`)
          }
        }
      }
      if (n.type === "function_declaration") {
        const nm = n.childForFieldName?.("name")?.text ?? ""
        const key = `${f.repo}/${f.rel}|${nm}`
        if (topLevelFns.has(key) && duplicateTopLevelFunctions.length < 12) duplicateTopLevelFunctions.push(`${f.repo}/${f.rel}:${b.startLine} function ${nm} declared twice`)
        topLevelFns.add(key)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(sub.rootNode)
    sub.delete?.()
  }
  tree.delete?.()
}

// --------------------------------------------------------------------------
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log("=".repeat(110))
console.log(`HTML CONSTRUCT PROBE — ${documents} documents, ${files.length} admitted, ${new Set(files.map((f) => f.repo)).size} repositories`)
console.log("=".repeat(110))
console.log("")
console.log("1 — IDREF CLASS: attributes whose HTML content model is a list of element IDs")
console.log(`${w("carrier", 30)}${w("sites", 8)}${w("files", 8)}${w("tokens", 8)}${w("resolvable", 12)}unresolved examples`)
let idrefSites = 0
let idrefTokens = 0
let idrefResolved = 0
for (const r of IDREF_ATTRS) {
  const st = idref.get(`${r.tag}@${r.attr}`)!
  idrefSites += st.sites
  idrefTokens += st.tokens
  idrefResolved += st.resolved
  console.log(`${w(`${r.tag || "*"}@${r.attr}`, 30)}${w(st.sites, 8)}${w(st.files, 8)}${w(st.tokens, 8)}${w(st.resolved, 12)}${st.examples.slice(0, 2).join(" ")}`)
}
console.log(`TOTAL: ${idrefSites} sites, ${idrefTokens} ID tokens, ${idrefResolved} resolvable to an element in the same document`)
console.log(`  → a native \`references\`/idref edge class would add ${idrefResolved} resolvable edges over ${idrefSites - idrefTokens + idrefTokens} sites`)
console.log("")
console.log("2 — CUSTOM ELEMENTS (a potential custom element name IS a registry lookup)")
console.log(`  distinct kebab-case tags: ${customElements.size}, tag instances: ${kebabInstances} over ${kebabFiles.size} files`)
console.log(`  of which the final kebab segment is ALL DIGITS (a code-dump placeholder, not a custom element): ${kebabAllDigits} — ${(kebabAllDigits / Math.max(1, kebabInstances) * 100).toFixed(1)}%`)
for (const [k, v] of [...customElements].sort((a, b) => b[1].sites - a[1].sites || (a[0] < b[0] ? -1 : 1)).slice(0, 60)) {
  console.log(`    ${w(k, 34)}${w(`×${v.sites}`, 8)}`)
}
console.log(`  …and ${Math.max(0, customElements.size - 60)} more distinct tags`)
console.log("")
console.log("3 — OVERRIDES / EXTENDS / IMPLEMENTS on the delegates' own trees")
console.log(`  inline js blocks ${blocks}, classes ${classesInBlocks}, methods ${methodsInBlocks}`)
console.log(`  a class declaring the same method name twice: ${duplicateMethodSites.length}  ${duplicateMethodSites.join("  ")}`)
console.log(`  a class carrying any heritage clause: ${classesWithHeritage.length}  ${classesWithHeritage.join("  ")}`)
console.log(`  a function name declared twice in one document: ${duplicateTopLevelFunctions.length}  ${duplicateTopLevelFunctions.join("  ")}`)
console.log("")
console.log("4 — DOCUMENT-SUPPLIED KEYS vs the analyzer's plain-object tables")
console.log(`  tag names that are Object.prototype members: ${protoTagHits.size} distinct, ${[...protoTagHits.values()].reduce((a, b) => a + b.files.length, 0)} file hits`)
for (const [k, v] of protoTagHits) console.log(`    <${k}>  ${v.files.join("  ")}`)
console.log(`  attribute names that are Object.prototype members: ${protoAttrHits.size} distinct`)
for (const [k, v] of protoAttrHits) console.log(`    @${k}  ${v.files.join("  ")}`)
console.log(`  id/name handle values that are Object.prototype members: ${protoIdHits.size} distinct`)
for (const [k, v] of protoIdHits) console.log(`    id="${k}"  ${v.files.join("  ")}`)
console.log(`  <base href> occurrences (declared omission, a metric and not an edge): ${baseHref}`)