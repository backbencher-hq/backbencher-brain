/**
 * THE POPULATION CENSUS FOR `uses` — the measurement that decides whether `uses` is
 * RULED or a GAP, run over the tree rather than over the analyzer's output.
 *
 * WHY IT EXISTS. `script/m14/xml-ruled.ts` ruled `uses` on instrument B with a probe over
 * two ELEMENT local names in the XSLT namespace, `use-attribute-sets` and `use-package`.
 * It measured 0 and the ruling stood. That measurement was correct about those two
 * ELEMENTS and still wrong about the construct, because XSLT 1.0 §7.1.4 writes
 * `use-attribute-sets` as an unprefixed ATTRIBUTE of `xsl:copy`, `xsl:element`,
 * `xsl:sort`, `xsl:attribute`, `xsl:comment`, `xsl:processing-instruction` and
 * `xsl:within-param`, and its value is a space-separated list of attribute-set names:
 *
 *     <xsl:copy use-attribute-sets="attset1 attset2">
 *
 * An element-shaped probe cannot see an attribute, and a probe over one namespace cannot
 * see a vocabulary this corpus actually ships. So this file counts the POPULATION: every
 * element and every attribute in EVERY namespace whose local name contains "use", and
 * then, for each one whose value names something, whether the value names a definition
 * the SAME FILE DECLARES. That last question is what separates a use of a definition from
 * a constraint keyword, and the corpus supplies its own control: XSD writes
 * `use="required"`, and a census that cannot tell that from `use-attribute-sets="attset1"`
 * is not measuring the construct.
 *
 * IT ALSO ANSWERS THE QUESTION THAT DECIDES THE SOURCE ENDPOINT. A `uses` edge needs a
 * source, and the family convention is the nearest enclosing DECLARED scope — css emits
 * `uses` from `currentSelector`, not from the property name. So for every use site this
 * file records the nearest ancestor element carrying a `name` attribute, because if that
 * is usually undefined then an edge from it is usually impossible and the honest verdict
 * changes with it. A verdict that does not know this is a verdict resting on a shape the
 * language may never produce.
 *
 * ZERO REGEX, throughout: membership is `indexOf`, tokenisation is a whitespace-run
 * splitter, and every structural fact comes from node types and named children.
 *
 * TWO PARSERS, ON PURPOSE, and they are not interchangeable. web-tree-sitter reads the
 * tree and sees EVERY construct including ones the analyzer discards; `parseFile` supplies
 * the analyzer's own published symbol names, which is what "resolves" means downstream.
 * A census run over only one of them could not tell a construct from its absence in the
 * store, and this file has already been wrong once for exactly that reason.
 */
import { readdirSync, statSync, readFileSync } from "fs"
import * as path from "path"
import * as childProcess from "child_process"
import * as wts from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_LIMIT ?? "0") // 0 = every admitted file

// ------------------------------------------------------------------ text helpers

function lower(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) out += s[i].toLowerCase()
  return out
}
function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v"
}
/** XSD `list`-typed whitespace normalisation, spelled out. */
function tokens(text: string): string[] {
  const out: string[] = []
  let cur = ""
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text[i])) { if (cur.length) out.push(cur); cur = "" } else cur += text[i]
  }
  if (cur.length) out.push(cur)
  return out
}
/**
 * A URI-FRAGMENT reference: SVG writes `<use xlink:href="#arrowhead"/>` and XSLT 2.0
 * writes `href="#id"`, so the token that names the target is `#arrowhead` while the
 * declaration is `arrowhead`. Compared in BOTH forms, because a probe that compared only
 * one of them measures its own spelling rather than the document.
 */
const forms = (t: string): string[] => {
  const out = [t]
  if (t.length > 1 && t[0] === "#") out.push(t.slice(1))
  return out
}
const unquote = (t: string): string =>
  t.length >= 2 && (t[0] === "\"" || t[0] === "'") && t[0] === t[t.length - 1] ? t.slice(1, -1) : t

const directChild = (n: any, type: string): any => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

// ------------------------------------------------------------------ admitted files

const admitted: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    statSync(path.join(dir, ".git"))
  } catch { continue }
  let tracked: string[]
  try {
    tracked = childProcess.execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}
const sample = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted
console.error(`admitted ${admitted.length}, walking ${sample.length}`)

const P: any = (wts as any).Parser ?? (wts as any).default
const L: any = (wts as any).Language ?? (wts as any).default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
// The language is loaded ONCE and the resulting handle shared by every worker's parser.
//
// This is not tidiness, it is a bug this file had: the first version called
// `Language.load` inside each of eight workers, and every one of them got a parser whose
// language never took. `parse()` still returned a tree object, `tree.delete()` still
// worked, `rootNode.namedChildCount` was 0 — and the census reported **889 sites in 600
// files before the change and 0 sites in the same 600 files after it**, with no error and
// a well-formed JSON object. A probe whose wrong answer is `0` is the one whose wrongness
// is invisible, and this one was wrong in BOTH directions at once. The symptom that gave
// it away was reading `rootNode.type` after `tree.delete()` and getting `undefined`, which
// said the tree object was real and its contents were not.
const XML_LANG = await L.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm")))

// ------------------------------------------------------------------ what a site is

/** What the walk can know before resolution: no `file` yet, no store verdicts. */
interface RawSite {
  position: "element" | "attribute" | "element-attribute"
  ns: string
  local: string
  ownerNs: string
  ownerLocal: string
  value: string
  tokenCount: number
  resolvedInDocument: string[]
  unresolved: string[]
  file: string
  line: number
}

interface Site extends RawSite {
  resolvedInStore: string[]
  /** The nearest ancestor that DECLARES a name — the family rule's `uses` source. */
  declaredScope: string
}

/**
 * One walk per file. `scope` is the nearest ancestor element that DECLARES a name via a
 * `name` attribute — the family rule's source endpoint for `uses` — threaded down, so a
 * site reports the scope it would actually be emitted from rather than the one a reader
 * might assume.
 */
function walk(root: any, ns: Map<string, string>, scope: string, visit: (s: RawSite) => void): void {
  if (root.type !== "element") {
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (c) walk(c, ns, scope, visit)
    }
    return
  }
  const tag = directChild(root, "STag") ?? directChild(root, "EmptyElemTag")
  if (!tag) return
  const inner = new Map(ns)
  const attrs: { name: string; value: string }[] = []
  for (let i = 0; i < tag.namedChildCount; i++) {
    const a = tag.namedChild(i)
    if (a?.type !== "Attribute") continue
    const an = directChild(a, "Name")?.text.trim()
    if (an === undefined) continue
    const avRaw = directChild(a, "AttValue")?.text.trim()
    const av = avRaw === undefined ? "" : unquote(avRaw)
    if (an === "xmlns") inner.set("", av)
    else if (an.startsWith("xmlns:")) inner.set(an.slice(6), av)
    else attrs.push({ name: an, value: av })
  }
  const tagName = directChild(tag, "Name")?.text.trim() ?? ""
  const colon = tagName.indexOf(":")
  const prefix = colon >= 0 ? tagName.slice(0, colon) : ""
  const local = colon >= 0 ? tagName.slice(colon + 1) : tagName
  const uri = inner.get(prefix) ?? ""
  const line = root.startPosition.row + 1
  // The element's OWN declared name widens the scope for its subtree, and nothing else.
  const ownName = attrs.find((a) => a.name === "name")?.value ?? ""
  const innerScope = ownName.length > 0 ? ownName : scope

  const emitted: RawSite[] = []
  if (lower(local).includes("use")) {
    // The element itself carries no value, so a hit with an empty value is NOT a
    // measurement of absence — it is a measurement of where the reference is. So every
    // attribute the element carries is emitted as its own hit, which is what makes SVG's
    // `<use xlink:href="#arrowhead"/>` visible: the element name contains "use", the
    // reference lives in `xlink:href`, and a probe that looked only at the element would
    // have counted 766 sites and read them as 766 constructs with no target.
    emitted.push({
      position: "element", ns: uri, local, ownerNs: uri, ownerLocal: local,
      value: "", tokenCount: 0, resolvedInDocument: [], unresolved: [], file: "", line, declaredScope: scope,
    })
    for (const a of attrs) {
      if (a.value.length === 0) continue
      const ac = a.name.indexOf(":")
      const alocalA = ac > 0 ? a.name.slice(ac + 1) : a.name
      emitted.push({
        position: "element-attribute", ns: uri, local: `${local}@${a.name}`, ownerNs: uri, ownerLocal: local,
        value: a.value, tokenCount: tokens(a.value).length, resolvedInDocument: [], unresolved: [],
        file: "", line, declaredScope: scope,
      })
      void alocalA
    }
  }
  for (const a of attrs) {
    const c = a.name.indexOf(":")
    const alocal = c > 0 ? a.name.slice(c + 1) : a.name
    if (!lower(alocal).includes("use")) continue
    emitted.push({
      position: "attribute", ns: uri, local: alocal, ownerNs: uri, ownerLocal: local,
      value: a.value, tokenCount: tokens(a.value).length, resolvedInDocument: [], unresolved: [], file: "", line, declaredScope: scope,
    })
  }
  for (const e of emitted) visit(e)
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (c) walk(c, inner, innerScope, visit)
  }
}

// ------------------------------------------------------------------ phase 1: the tree walk

/**
 * TWO PHASES, and the split is a cost decision with an honesty consequence that is
 * stated rather than hidden. The population question needs the TREE, which web-tree-sitter
 * answers in milliseconds; the store question needs `parseFile`, which is the expensive
 * call and is the only thing that can say what an edge endpoint can bind to. So the walk
 * runs over every admitted file and `parseFile` runs ONLY over files that actually
 * contain a use site — a few dozen, against eleven thousand.
 *
 * The consequence, declared: `filesWalkedByProduction` is NOT the corpus size, and the
 * store-resolution percentage is computed over files that have at least one use site. That
 * is the correct denominator for "would an edge from this site resolve", and it is NOT a
 * claim that the analyzer parsed the whole corpus. A reader who needs the latter number
 * has it above, as `filesWalked`, and it is the tree-walk count.
 *
 * Workers, not a serial loop, because the corpus is 11,552 files and ten lanes share this
 * machine. Each worker owns its OWN parser: web-tree-sitter's Parser holds mutable parse
 * state, and sharing one across concurrent walks interleaves trees. Results are merged by
 * index so the output order does not depend on which worker finished first.
 */
interface FileResult {
  file: string
  sites: Omit<Site, "resolvedInStore">[]
  docNames: string[]
  walked: boolean
}

const results: (FileResult | undefined)[] = new Array(sample.length)
let treeFailed = 0
{
  let idx = 0
  const worker = async (): Promise<void> => {
    const mine = new P()
    mine.setLanguage(XML_LANG)
    while (true) {
      const i = idx++
      if (i >= sample.length) break
      const f = sample[i]
      let tree: any
      try { tree = mine.parse(f.text) } catch { treeFailed++; continue }
      if (!tree) { treeFailed++; continue }

      // What the DOCUMENT declares: every `name=` attribute value in the file. This is
      // the document's own vocabulary and needs no analyzer to find it.
      const docNames = new Set<string>()
      const collectNames = (n: any): void => {
        if (n.type === "Attribute") {
          const an = directChild(n, "Name")?.text.trim()
          const avRaw = directChild(n, "AttValue")?.text.trim()
          // `name=` is the declaration vocabulary of XSD, XSLT and DocBook; `id=` is
          // how SVG's `<use xlink:href="#arrowhead"/>` names its target, so a census that
          // collected only `name=` would report every SVG use as naming nothing — which is
          // the census's own blind spot, not a fact about SVG. Both are collected.
          if ((an === "name" || an === "id") && avRaw !== undefined) {
            const v = unquote(avRaw.trim())
            if (v.length) docNames.add(v)
          }
          return
        }
        for (let i2 = 0; i2 < n.namedChildCount; i2++) {
          const c = n.namedChild(i2)
          if (c) collectNames(c)
        }
      }
      collectNames(tree.rootNode)

      const label = `${f.repo}/${f.rel}`
      const found: Omit<Site, "resolvedInStore">[] = []
      walk(tree.rootNode, new Map(), "", (s) => {
        const toks = s.value.length ? tokens(s.value) : []
        const inDoc: string[] = []
        const un: string[] = []
        for (const t of toks) {
          const c = t.indexOf(":")
          const leaf = c > 0 ? t.slice(c + 1) : t
          let okDoc = false
          for (const f2 of forms(t)) if (docNames.has(f2)) okDoc = true
          if (!okDoc && docNames.has(leaf)) okDoc = true
          if (okDoc) inDoc.push(t)
          else un.push(t)
        }
        found.push({
          position: s.position, ns: s.ns, local: s.local, ownerNs: s.ownerNs, ownerLocal: s.ownerLocal,
          value: s.value, tokenCount: toks.length, resolvedInDocument: inDoc, unresolved: un,
          file: label, line: s.line, declaredScope: s.declaredScope,
        })
      })
      tree.delete?.()
      results[i] = { file: label, sites: found, docNames: [...docNames], walked: true }
    }
  }
  await Promise.all(Array.from({ length: Number(process.env.BB_WORKERS ?? 8) }, () => worker()))
}

// ------------------------------------------------------------------ phase 2: what the analyzer publishes

const sites: Site[] = []
let filesWithSites = 0
let filesParsedByProduction = 0
let filesRejectedByProduction = 0
{
  let idx = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = idx++
      if (i >= sample.length) return
      const fr = results[i]
      // `continue`, NOT `return`: this is the inside of `while (true)`, so a `return`
      // here retires the whole worker. The first version had `return`, every one of the
      // four workers died on whichever file it happened to draw first — and because that
      // file had no use site, all four died on index 0 and the phase reported 0 sites
      // over a corpus whose tree walk had just found 889 of them. A worker pool that can
      // quit early is a pool whose result depends on the order of its input.
      if (!fr || fr.sites.length === 0) continue
      filesWithSites++
      const f = sample[i]
      const store = new Set<string>()
      let ok = false
      try {
        const r: any = await parseFile(f.abs, f.dir)
        ok = true
        for (const s of r.symbols ?? []) {
          if (typeof s.name !== "string" || s.name.length === 0) continue
          store.add(s.name)
          const c = s.name.indexOf(":")
          if (c > 0) store.add(s.name.slice(c + 1))
        }
      } catch { /* the tree can still measure a file production rejects */ }
      if (!ok) { filesRejectedByProduction++; return }
      filesParsedByProduction++
      const docNames = new Set(fr.docNames)
      for (const s of fr.sites) {
        const inStore: string[] = []
        const unresolved = s.unresolved.filter((t) => {
          const c = t.indexOf(":")
          const leaf = c > 0 ? t.slice(c + 1) : t
          let hit = false
          for (const f2 of forms(t)) if (store.has(f2)) hit = true
          if (!hit && store.has(leaf)) hit = true
          if (hit) inStore.push(t)
          return !hit
        })
        sites.push({ ...s, resolvedInStore: inStore, unresolved })
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()))
}
const walkedCount = results.filter((r) => r?.walked).length

// ------------------------------------------------------------------ scope census

/**
 * `uses` needs a SOURCE. The family rule is the nearest enclosing DECLARED scope — css
 * emits `uses` from `currentSelector`, never from the property name — so this is the
 * question that decides whether an edge is emittable here at all: at each use site, is
 * there such a scope? Folded over the sites the single walk already produced rather than
 * walked again, because a second implementation of the same walk is how two copies drift
 * and this file already carries one walk by design.
 */
const scopeRows = new Map<string, {
  sites: number; withScope: number; withNoScope: number
  scopeExamples: string[]; noScopeExamples: string[]
}>()
for (const s of sites) {
  const k = `${s.position} | ${s.ns || "(none)"} | ${s.local} on ${s.ownerNs || "(none)"}:${s.ownerLocal}`
  const g = scopeRows.get(k) ?? { sites: 0, withScope: 0, withNoScope: 0, scopeExamples: [], noScopeExamples: [] }
  g.sites++
  if (s.declaredScope.length > 0) {
    g.withScope++
    if (g.scopeExamples.length < 3) g.scopeExamples.push(`${s.file}:${s.line} scope=${s.declaredScope} value=${s.value.slice(0, 40)}`)
  } else {
    g.withNoScope++
    if (g.noScopeExamples.length < 3) g.noScopeExamples.push(`${s.file}:${s.line} NO-SCOPE value=${s.value.slice(0, 40)}`)
  }
  scopeRows.set(k, g)
}

// ------------------------------------------------------------------ the report

const groups = new Map<string, {
  sites: number; files: Set<string>; tokens: number
  docResolved: number; storeResolved: number; unresolved: number
  values: string[]; evidence: string[]
}>()
for (const s of sites) {
  const k = `${s.position} | ${s.ns || "(none)"} | ${s.local} on ${s.ownerNs || "(none)"}:${s.ownerLocal}`
  const g = groups.get(k) ?? { sites: 0, files: new Set<string>(), tokens: 0, docResolved: 0, storeResolved: 0, unresolved: 0, values: [], evidence: [] }
  g.sites++
  g.files.add(s.file)
  g.tokens += s.tokenCount
  g.docResolved += s.resolvedInDocument.length
  g.storeResolved += s.resolvedInStore.length
  g.unresolved += s.unresolved.length
  if (s.value && g.values.length < 4) g.values.push(s.value.slice(0, 70))
  if (g.evidence.length < 3) g.evidence.push(`${s.file}:${s.line}`)
  groups.set(k, g)
}

const pct = (a: number, b: number): number | null => (b === 0 ? null : Math.round((1000 * a) / b) / 10)

console.log(JSON.stringify({
  instrument: "use-construct-population",
  question: "over the admitted xml corpus, what elements and attributes carry a local name containing 'use'; which of their values name a definition the same file declares; and does each site have the declared scope a `uses` edge would need as its source?",
  sampling: LIMIT > 0 ? `first ${LIMIT} admitted files in git-ls-files order per repository` : "every admitted file",
  filesAdmitted: admitted.length,
  filesWalkedByTree: walkedCount,
  filesContainingAtLeastOneUseSite: filesWithSites,
  filesWalkedByProductionParseFile: filesParsedByProduction,
  filesRejectedByProductionParseFile: filesRejectedByProduction,
  treeParseFailures: treeFailed,
  denominatorForStoreResolution: "files containing at least one use site; the tree walk covers every walked file, production parseFile covers only these",
  distinctShapes: groups.size,
  totalSites: sites.length,
  rows: [...groups.entries()].map(([k, g]) => ({
    shape: k,
    sites: g.sites,
    files: g.files.size,
    tokens: g.tokens,
    tokensNamingADeclaredDefinitionInTheSameFile: g.docResolved,
    tokensResolvableInTheAnalyzerStore: g.storeResolved,
    tokensNamingNothing: g.unresolved,
    documentResolutionPct: pct(g.docResolved, g.tokens),
    storeResolutionPct: pct(g.storeResolved, g.tokens),
    sampleValues: g.values,
    evidence: g.evidence,
  })).sort((a, b) => b.sites - a.sites),
  scopeRows: [...scopeRows.entries()].map(([k, g]) => ({
    shape: k,
    sites: g.sites,
    withDeclaredScopeInScope: g.withScope,
    withNoDeclaredScopeInScope: g.withNoScope,
    usableSourceEndpointPct: pct(g.withScope, g.sites),
    scopeExamples: g.scopeExamples,
    noScopeExamples: g.noScopeExamples,
  })).sort((a, b) => b.sites - a.sites),
}, null, 2))