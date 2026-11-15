/**
 * DERIVATION ACCOUNTING — why 1,652 XSD derivation sites on the tree produce 438
 * `extends` edges.
 *
 * ## THE QUESTION
 *
 * `script/m14/xml-ruled.ts`'s instrument-B probe for `extends` counts real XSD
 * derivation sites (`<xs:extension base="T">` / `<xs:restriction base="T">`, XSD 1.0
 * Part 1 §3.4.2) on the parse tree. Over the full 11,456-file admitted population:
 *
 *   XML_B_PROBE_WALK extends  walked=11456  occurrences=1652  hitFiles=113
 *
 * Production `parseFile`, from the gate's own `observed` tally:
 *
 *   extends  EMITTED  438 edges
 *
 * 1,652 sites, 438 edges. The gate does not print this ratio and does not treat it as a
 * defect: `extends` has a non-zero `observed.n`, so the verdict loop `continue`s at the
 * first branch and never consults a ruling. The type is EMITTED and adjudication STOPS.
 * That is right for the verdict, and it is exactly where a shortfall can sit unread, so
 * this probe answers the question the verdict structurally cannot.
 *
 * ## THE COMPARISON IS AGAINST EMITTED EDGES, NOT AGAINST A RE-DERIVED DECISION
 *
 * The obvious design — re-derive the analyzer's four-way accept/refuse test and compare —
 * was rejected, and the reason is the same one that rejects every oracle built on the
 * analyzer's own helpers. `src/ast/real-xml-analyzer.ts` builds `declaredNames` in SEVEN
 * places (lines 782, 857, 956, 987, 1148 and the seed at 429) and `importedNamespaces`
 * at 450/1494. A copy of that decision is a copy that drifts, and a drifted copy reports
 * a shortfall that is really a stale constant — or hides a real one.
 *
 * So the question is inverted. Each file is parsed ONCE by production `parseFile` and the
 * real edges are collected; each file is parsed ONCE by the grammar and every derivation
 * site is collected; and a site is MATCHED to an edge by its file, its `base` attribute
 * value and its `xs:extension`/`xs:restriction` kind. A site with a matching edge is
 * COVERED, full stop — no re-derivation, nothing to drift. A site with no matching edge
 * is REFUSED, and the refusal is then described by properties read off the tree.
 *
 * ## WHAT THIS PROBE CAN AND CANNOT FIND
 *
 *   CAN: every site that produced no edge, counted and classified by observable shape.
 *   CAN: every emitted edge accounted for by a real site, or NOT accounted for — which
 *        would be an edge with no site behind it, the more serious direction.
 *   CANNOT: prove the emitted edges are CORRECT. This is a coverage ledger, not an
 *        oracle. For the correctness direction see `script/m14/differential.ts`, and note
 *        the limitation recorded in the lane doc: that oracle is a separate walker over
 *        the same grammar, so a grammar-level fault is invisible to both.
 *
 * ## THE FIVE REFUSAL CLASSES, AND WHY THE ANALYZER MAY REFUSE AT ALL
 *
 * `src/ast/real-xml-analyzer.ts:1781-1817` accepts a candidate when the base is
 * resolvable in-document, a builtin, or names an imported namespace, and when none of
 * those holds but the value is a BARE name owned by a schema vocabulary it still emits
 * with `resolvable: "unresolved"`. It `continue`s — emitting nothing — otherwise. The
 * classes below are the OBSERVED shape of the refused sites, not a restatement of the
 * analyzer's test:
 *
 *   E-bare-nonvocabulary      `base="T"` where no ancestor establishes the XSD namespace
 *   F-prefixed-unimported     `base="p:T"` where prefix p is bound, but to a namespace
 *                             this document never imports and that is not a builtin
 *   G-prefixed-unbound        `base="p:T"` where prefix p is not bound at all
 *   H-no-declaration-in-file  `base="T"` and no element in the file DECLARES a name T —
 *                             the sub-case where a reader might expect an edge and the
 *                             document does not support one
 *
 * ## ZERO REGEX
 *
 * The lane rule, load-bearing here. The naive probe for this question splits the `base`
 * attribute's TEXT on a colon. That matches `base="xs:string"` and it equally matches a
 * `base` value sitting inside a comment or a CDATA section — the defect class bash's
 * binding-site probe had to decline three times over (`# read x`, `echo "read x"`, a
 * heredoc body). This probe reads the tree: `element` → `STag`/`EmptyElemTag` →
 * `Attribute` → `AttValue`, with bindings resolved from each element's OWN tag and
 * threaded down through ancestors. A DocBook `<interface>` and an XSLT `<template>` are
 * the same `element` node type to this grammar; only the namespace says which language a
 * declaration is written in.
 *
 * ## RUN
 *
 *   npx tsx validation/m14/fixtures/xml/derivation-accounting.mts
 *
 *   BB_CORPUS_ROOT=<dir>   corpus root, default /home/ishaq2321/bb_tests/repositories
 *   BB_XML_WORKERS=<n>     worker count, default 1 — see the BB_XML_WORKERS header of
 *                          validation/m14/fixtures/xml/ontology-census.mts for why 1
 *   BB_DERIV_MAX=<n>       cap on admitted files, default 0 = the whole admitted set
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WORKERS = Number(process.env.BB_XML_WORKERS ?? "1")
const MAX_FILES = Number(process.env.BB_DERIV_MAX ?? "0")
const HERE = import.meta.dirname
const OUT = path.join(HERE, "derivation-accounting.json")

const XSD_NS = "http://www.w3.org/2001/XMLSchema"

// ── the analyzer's own constants, READ FROM THE CLASS rather than scraped ────
//
// A hand-copied constant is a second source of truth that drifts silently, and this
// probe's whole value is that it does not re-derive the analyzer's decision. Reading the
// values off the class is stronger than scraping them out of its source text: TypeScript
// `private` is erased at runtime, so `RealXmlAnalyzer.BUILTIN_NAMESPACE_URIS` is the
// analyzer's OWN live set, and a constant the analyzer changes is a constant this probe
// sees changed. An earlier version of this file parsed `new Set([` out of the source and
// threw on the `private static readonly NAME: Type =` prefix — a reminder that text
// extraction is a second parser with none of a parser's guarantees.
const { RealXmlAnalyzer } = await import("../../../../src/ast/real-xml-analyzer")
const internals = RealXmlAnalyzer as unknown as {
  BUILTIN_NAMESPACE_URIS: ReadonlySet<string>
  XSD_BUILTIN_TYPE_NAMES: ReadonlySet<string>
  DECLARATION_VOCABULARIES: Readonly<Record<string, ReadonlySet<string>>>
}
const BUILTIN_NAMESPACE_URIS = internals.BUILTIN_NAMESPACE_URIS
const XSD_BUILTIN_TYPE_NAMES = internals.XSD_BUILTIN_TYPE_NAMES
const DECLARATION_VOCABULARIES = internals.DECLARATION_VOCABULARIES
if (!BUILTIN_NAMESPACE_URIS || !XSD_BUILTIN_TYPE_NAMES || !DECLARATION_VOCABULARIES) {
  throw new Error("could not read the analyzer's constant sets — they were renamed or made genuinely private")
}
console.error(
  `constants read from the analyzer's own class: BUILTIN_NAMESPACE_URIS=${BUILTIN_NAMESPACE_URIS.size}` +
    ` XSD_BUILTIN_TYPE_NAMES=${XSD_BUILTIN_TYPE_NAMES.size}` +
    ` DECLARATION_VOCABULARIES=${Object.keys(DECLARATION_VOCABULARIES).length}`,
)

// ── corpus discovery: the gate's rule, copied EXACTLY ───────────────────────
//
// The population here has to BE the population script/m14/ontology-coverage-gate.ts
// measured, or "1,652 sites against 438 edges" is two numbers from two samples and the
// ratio between them means nothing. The gate's rule is git-tracked files only, a 512 KiB
// cap, and `detectLanguageFromPath(abs, text)` with the CONTENT as a second argument.
//
// All three details were got wrong in the first version of this file, and the symptom was
// the only reason this is worth writing down: it walked the filesystem, capped at 5 MB and
// called detectLanguageFromPath with the PATH alone, and admitted 6,318 files against the
// gate's 11,456. Content-based detection is what admits the extra half — files whose
// extension says nothing (`Info.plist`, `.storyboard`, extensionless) are recognised by
// their text. A probe that quietly draws a different sample and reports a ratio against
// someone else's numerator is worse than no probe, because the ratio looks like a finding.
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
const admittedTotal = files.length
const admitted = MAX_FILES > 0 ? files.slice(0, MAX_FILES) : files
console.error(
  `derivation-accounting: ${admitted.length} admitted files (${admittedTotal} discovered), ${WORKERS} worker(s)` +
    `  [gate reported 11456 on the same corpus]`,
)
if (admittedTotal === 0) throw new Error("no files admitted — the corpus root is wrong")

// ── phase 1 — production edges ───────────────────────────────────────────────
/** The endpoint fields are `source` and `target`, NOT `from`/`to`. An earlier version of this
 *  file read `rel.from`/`rel.to`, which are undefined on every relationship, and printed
 *  `undefined -> undefined` for all 438 edges — a fabricated-looking result produced purely
 *  by reading fields that do not exist. Same class of error as passing file text into
 *  `parseFile`'s `projectPath` slot: a wrong value in a position the type system cannot
 *  check because both shapes are strings. */
type Edge = { qname: string; derivation: string; resolvable: string; from: string; to: string; line: number | undefined }
type CallEdge = { from: string; to: string; line: number | undefined }
const edgesByFile = new Map<string, Edge[]>()
/** `calls` edges, collected in phase 1 alongside `extends` and classified below. Declared
 *  HERE because phase 1 writes to it and a `const` below the call site is a temporal dead
 *  zone throw — the second time this file has died on its own plumbing. */
const callsByFile = new Map<string, CallEdge[]>()
type RefEdge = { from: string; to: string; resolvable: string; role: string }
/** `references` edges, for the same source-authenticity question. `references` resolves
 *  at 49.1% on this lane's draw against CSS's 66.8%, and the `extends`/`calls` finding
 *  says a low resolution rate is NOT the place a fabricated endpoint shows up — a minted
 *  source resolves perfectly — so the rate alone settles nothing and the source has to be
 *  asked directly. */
const refsByFile = new Map<string, RefEdge[]>()
/** Sum of `metadata.occurrences` over every `calls` edge. Edge identity is the triple
 *  (source, type, target) and `addRelationship` folds repeats, counting the fold rather
 *  than losing it — so this is the number of call SITES the graph actually represents,
 *  and comparing it against the covered-site count is the check that no site was dropped
 *  without being counted. The `extends` half has the equivalent, `edgesWithNoSiteBehindThem`. */
let callsOccurrences = 0
let parseErrs = 0
let totalEdges = 0
let cursor = 0

const worker = async (): Promise<void> => {
  for (;;) {
    const i = cursor++
    if (i >= admitted.length) return
    const f = admitted[i]
    const label = `${f.repo}/${f.rel}`
    // `parseFile(filePath, projectPath, context?)` — the second argument is the PROJECT
    // path, not the file's text. The first version of this file passed the text there,
    // which typechecked (both are strings) and silently gave parseFile a projectPath that
    // does not exist. It is recorded because it is the same mistake twice in this lane's
    // history: a string-typed parameter slot accepts the wrong string with no complaint.
    const r = await parseFile(f.abs, f.dir)
    const list: Edge[] = []
    const callList: CallEdge[] = []
    const refList: RefEdge[] = []
    for (const rel of r.relationships) {
      if (rel.type === "references") {
        refList.push({ from: rel.source, to: rel.target, resolvable: String((rel.metadata as any)?.resolvable ?? ""), role: String((rel.metadata as any)?.role ?? "") })
        continue
      }
      if (rel.type === "calls") {
        callList.push({ from: rel.source, to: rel.target, line: (rel as any).line })
        callsOccurrences += Number((rel.metadata as any)?.occurrences ?? 1)
        continue
      }
      if (rel.type !== "extends") continue
      totalEdges++
      list.push({
        qname: String((rel.metadata as any)?.qname ?? ""),
        derivation: String((rel.metadata as any)?.derivation ?? ""),
        resolvable: String((rel.metadata as any)?.resolvable ?? ""),
        from: rel.source,
        to: rel.target,
        line: (rel as any).line,
      })
    }
    if (refList.length > 0) refsByFile.set(label, refList)
    if (list.length > 0) edgesByFile.set(label, list)
    if (callList.length > 0) callsByFile.set(label, callList)
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))
console.error(`phase 1: ${totalEdges} extends edges from production parseFile across ${edgesByFile.size} files`)

// ── phase 2 — derivation sites on the tree ───────────────────────────────────
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm"))))

type ElementFacts = { local: string; prefix: string; ns: string | undefined; attrs: Map<string, string>; boundPrefixes: Set<string> }

const directChild = (n: any, type: string): any => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}
const unquote = (text: string): string => {
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === "\"" || first === "'") && first === last) return text.slice(1, -1)
  }
  return text
}
const splitQName = (value: string): { prefix: string; local: string } => {
  const colon = value.indexOf(":")
  return colon >= 0 ? { prefix: value.slice(0, colon), local: value.slice(colon + 1) } : { prefix: "", local: value }
}

/** The element's own attributes AND the bindings its own tag establishes. */
const readTag = (tag: any, ns: Map<string, string>): { attrs: Map<string, string>; inner: Map<string, string> } => {
  const attrs = new Map<string, string>()
  const inner = new Map(ns)
  for (let i = 0; i < tag.namedChildCount; i++) {
    const a = tag.namedChild(i)
    if (a?.type !== "Attribute") continue
    const an = directChild(a, "Name")?.text.trim()
    const avRaw = directChild(a, "AttValue")?.text.trim()
    const av = avRaw === undefined ? undefined : unquote(avRaw)
    if (an === "xmlns") inner.set("", av ?? "")
    else if (an?.startsWith("xmlns:")) inner.set(an.slice(6), av ?? "")
    else if (an) attrs.set(an, av ?? "")
  }
  return { attrs, inner }
}

type Cls = "A-covered" | "J-covered-collapsed" | "I-anonymous-owner" | "E-bare-nonvocabulary" | "F-prefixed-unimported" | "G-prefixed-unbound" | "H-bare-undeclared"
type Site = { file: string; kind: string; base: string; cls: Cls; line: number; owner: string | undefined; anyNamedAncestor: string | undefined }
const sites: Site[] = []
const byCls = new Map<Cls, number>()
const exampleByCls = new Map<Cls, string[]>()
const unparsedFiles: string[] = []
/** Declared names per file, filled in phase 2 and read by the source-authenticity ledger.
 *  Declared BEFORE `siteWorker` runs: a `const` after the call site is a temporal dead
 *  zone throw, which is the same lesson as the wrong-field-name run above in a different
 *  costume — a probe that dies on its own plumbing teaches nothing about the language. */
const declaredByFile = new Map<string, Set<string>>()
/** Same TDZ discipline as `declaredByFile`: filled in phase 2, read after it. */
const declaredXslNamesByFile = new Map<string, Set<string>>()
/** Every `name=` value in the file, any namespace — the superset declaration test. */
const declaredAnywhereByFile = new Map<string, Set<string>>()
/** "<namespace>\0<local>" for every element in a vocabulary namespace present in the file. */
const vocabLocalsByFile = new Map<string, Set<string>>()
/** Prefixes each file binds to the XSLT namespace. A `calls` source carrying one of these
 *  is a vocabulary tag by construction; a DECLARED XSLT name never carries a prefix,
 *  because it is the `name=` attribute's value. */
const xsltPrefixesByFile = new Map<string, Set<string>>()

/**
 * THE CALL-SITE LEDGER — the same coverage question `extends` was given, asked of `calls`.
 *
 * The fix dropped 146 `calls` edges (548 -> 402) and a rationale for a drop is not a count.
 * This enumerates every `xsl:call-template` carrying a `name` in the XSLT namespace on the
 * parse tree, and classifies each by whether the file DECLARES a named caller above it. A
 * site with no named enclosing template or variable is one `calls` must NOT publish, because
 * XSLT 1.0 §2.4 does not permit an instruction sequence at stylesheet top level — so those
 * are the refusals, and the count of them is what the 146 must equal.
 */
type CallSiteCls = "covered-callee-declared" | "covered-callee-undeclared" | "no-named-caller"
const callSitesByCls = new Map<CallSiteCls, { sites: number; files: number; examples: string[] }>()
const bumpCallSite = (c: CallSiteCls, ex: string, file: string): void => {
  const row = callSitesByCls.get(c) ?? { sites: 0, files: 0, examples: [] }
  row.sites++
  if (!row.examples.includes(file)) row.files++
  if (row.examples.length < 5) row.examples.push(ex)
  callSitesByCls.set(c, row)
}

const XSLT_NS = "http://www.w3.org/1999/XSL/Transform"
/** XSLT elements that can own a call: a named template, a variable whose body holds the
 *  call, a param, an XSLT 2.0 function, or a with-param child. */
const CALLER_ELEMENTS = new Set(["template", "variable", "param", "function", "with-param"])
/** Names DECLARED as XSD declaration elements in this file — a deliberate
 *  under-approximation of the analyzer's `declaredNames`, and the error direction is
 *  stated: it can only move a site from A into H, so H is an UPPER bound and A is not
 *  inflated by it. */
const DECL_ELEMENTS = new Set(["element", "attribute", "complexType", "simpleType", "group", "attributeGroup", "notation", "define", "list", "union"])

const siteWorker = (): void => {
  for (const f of admitted) {
    const label = `${f.repo}/${f.rel}`
    let tree: any = null
    try {
      tree = parser.parse(f.text)
    } catch {
      tree = null
    }
    if (!tree) {
      unparsedFiles.push(label)
      continue
    }
    const declaredHere = new Set<string>()
    const xslDeclared = new Set<string>()
    const declaredAnywhere = new Set<string>()
    const vocabLocalByNs = new Set<string>()
    const xslTemplatesDeclared = new Set<string>()
    const xsltPrefixes = new Set<string>()
    const callSites: { name: string; line: number; caller: string | undefined; calleeLocal: string }[] = []

    const sitesHere: { kind: string; base: string; binding: string | undefined; prefixed: boolean; bound: boolean; ownerVocabulary: boolean; line: number; nearestNamedOwner: string | undefined; namedOwnerKind: string; anyNamedAncestor: string | undefined }[] = []

    const recurse = (n: any, ns: Map<string, string>, ownerVocabulary: boolean, nearestNamedOwner: string | undefined, anyNamedAncestor: string | undefined, nearestCallerIn: string | undefined): void => {
      const isElement = n.type === "element"
      let inner = ns
      let nsUri: string | undefined
      let local = ""
      let callerForChildren = nearestCallerIn
      if (isElement) {
        const tag = directChild(n, "STag") ?? directChild(n, "EmptyElemTag")
        if (!tag) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) recurse(c, ns, ownerVocabulary, nearestNamedOwner, anyNamedAncestor, nearestCallerIn)
          }
          return
        }
        const read = readTag(tag, ns)
        const attrs = read.attrs
        inner = read.inner
        const q = splitQName(directChild(tag, "Name")?.text.trim() ?? "")
        local = q.local
        const prefix = q.prefix
        nsUri = inner.get(prefix) ?? (prefix === "" ? inner.get("") : undefined)
        if (nsUri === XSLT_NS && prefix.length > 0) xsltPrefixes.add(prefix)
        // A named XSLT caller in scope: the element's OWN `name=` if it is a caller
        // element, else the nearest one inherited. This mirrors the analyzer's
        // `nearestNamedDeclaration` independently — the probe re-derives it from the tree
        // rather than reading it off the analyzer, so agreement between the two is
        // evidence rather than a tautology.
        {
          // EVERY `name=` VALUE in the file, any namespace. This is the superset test for
          // "did this document declare that name" and it is deliberately wider than the
          // vocabulary-specific sets: a `references` source can be an ordinary application
          // element, and the question here is only whether the name is one the document
          // wrote down. Over-approximating declarations can only move a source OUT of
          // `undeclared`, so it biases toward NOT calling a real source fabricated.
          const nmAny = attrs.get("name")
          if (nmAny !== undefined && nmAny.length > 0) declaredAnywhere.add(nmAny)
        }
        // Vocabulary CONSTRUCTOR elements actually present in this file, by namespace. The
        // classifier below must NOT decide "this source is a vocabulary tag" from a list
        // of local names: `template` is an XSLT element name AND an ordinary application
        // element name, and db2-templates.xml has `<template name="...">` in NO namespace.
        // Deciding by local name alone reported that file's `template -> lt` entity
        // reference as fabricated when it is an ordinary element citing `&lt;`. So the test
        // is whether an element in a VOCABULARY namespace with that local name is present.
        if (nsUri === XSD_NS || nsUri === XSLT_NS) {
          vocabLocalByNs.add(nsUri + "\u0000" + local)
        }
        if (nsUri === XSLT_NS && CALLER_ELEMENTS.has(local)) {
          const nm = attrs.get("name")
          if (nm !== undefined && nm.length > 0) {
            xslDeclared.add(nm)
            // TEMPLATE names are tracked SEPARATELY from variable/param/function names,
            // because the analyzer's callee test is `declaredTemplateNames.has(name)`
            // (src/ast/real-xml-analyzer.ts:1700) and that set holds only xsl:template
            // names. Pooling them made this probe report one site as accepted that the
            // analyzer correctly refuses — a call whose "callee" is declared as a VARIABLE
            // is not a call to a template, and XSLT 1.0 §6 dispatches by template name.
            if (local === "template") xslTemplatesDeclared.add(nm)
            // A LOCAL, not a mutation of the closure's `nearestCaller`. The first version
            // assigned to the shared variable, which leaked a template's name to its
            // SIBLINGS and reported 1,509 covered sites against 481 published edges — a
            // 1,028-site "shortfall" that was entirely the probe's own scoping bug. A
            // number produced by a probe that is confidently wrong is worse than no number.
            callerForChildren = nm
          }
        }
        if (nsUri === XSLT_NS && local === "call-template") {
          const nm = attrs.get("name")
          if (nm !== undefined && nm.length > 0) {
            callSites.push({ name: nm, line: n.startPosition.row + 1, caller: nearestCallerIn, calleeLocal: ((): string => { const c = nm.indexOf(":"); return c >= 0 ? nm.slice(c + 1) : nm })() })
          }
        }
        if (nsUri === XSD_NS && DECL_ELEMENTS.has(local)) {
          const nm = attrs.get("name")
          if (nm !== undefined && nm.length > 0) {
            declaredHere.add(nm)
            nearestNamedOwner = nm
            anyNamedAncestor = nm
          }
        }
        if (nsUri === XSD_NS && (local === "extension" || local === "restriction")) {
          const base = attrs.get("base")
          if (base !== undefined && base.length > 0) {
            const q = splitQName(base)
            const binding = q.prefix.length === 0 ? inner.get("") : inner.get(q.prefix)
            sitesHere.push({
              kind: local,
              base,
              binding,
              prefixed: q.prefix.length > 0,
              bound: q.prefix.length === 0 || inner.has(q.prefix),
              ownerVocabulary,
              line: n.startPosition.row + 1,
              nearestNamedOwner,
              namedOwnerKind: nearestNamedOwner === undefined ? "anonymous" : "named",
              anyNamedAncestor,
            })
          }
        }
      }
      const childVocabulary = isElement && nsUri === XSD_NS ? true : ownerVocabulary
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) recurse(c, inner, childVocabulary, nearestNamedOwner, anyNamedAncestor, callerForChildren)
      }
    }
    recurse(tree.rootNode, new Map(), false, undefined, undefined, undefined)

    // Classify. Order matters and is stated: a base whose binding is a BUILTIN or an
    // IMPORTED namespace is one the analyzer resolves, so a site still unmatched here
    // with such a binding is a REAL shortfall and lands in H rather than being excused.
    for (const cs of callSites) {
      // Two INDEPENDENT refusals, and the class names keep them apart because they fail
      // for different reasons: no named CALLER means the site has no source to publish
      // (XSLT 1.0 §2.4 puts no instruction sequence at stylesheet top level), while an
      // undeclared CALLEE means the edge would name a template this file does not define
      // (src/ast/real-xml-analyzer.ts:1700 — an xsl:include could supply it, which from
      // inside one file is indistinguishable from a missing declaration).
      const cls: CallSiteCls =
        cs.caller === undefined ? "no-named-caller"
        : xslTemplatesDeclared.has(cs.calleeLocal) ? "covered-callee-declared"
        : "covered-callee-undeclared"
      bumpCallSite(cls, `${label}:${cs.line} <xsl:call-template name="${cs.name}"> caller=${cs.caller ?? "(none)"} calleeDeclared=${xslTemplatesDeclared.has(cs.calleeLocal)}`, label)
    }
    declaredByFile.set(label, declaredHere)
    declaredAnywhereByFile.set(label, declaredAnywhere)
    vocabLocalsByFile.set(label, vocabLocalByNs)
    declaredXslNamesByFile.set(label, xslDeclared)
    xsltPrefixesByFile.set(label, xsltPrefixes)
    const edges = edgesByFile.get(label) ?? []
    const edgeKeys = new Set(edges.map((e) => `${e.derivation} ${e.qname}`))
    const edgeTriples = new Set(edges.map((e) => `${e.from} ${e.derivation} ${e.qname}`))
    for (const s of sitesHere) {
      const q = splitQName(s.base)
      let cls: Cls
      if (s.namedOwnerKind === "anonymous") cls = "I-anonymous-owner"
      else if (edgeTriples.has(`${s.nearestNamedOwner} ${s.kind} ${s.base}`)) cls = "A-covered"
      else if (edgeKeys.has(`${s.kind} ${s.base}`)) cls = "J-covered-collapsed"
      else if (!s.prefixed && !s.ownerVocabulary) cls = "E-bare-nonvocabulary"
      else if (s.prefixed && !s.bound) cls = "G-prefixed-unbound"
      else if (s.prefixed && s.binding !== undefined && !BUILTIN_NAMESPACE_URIS.has(s.binding)) cls = "F-prefixed-unimported"
      else cls = "H-bare-undeclared"
      sites.push({ file: label, kind: s.kind, base: s.base, cls, line: s.line, owner: s.nearestNamedOwner, anyNamedAncestor: s.anyNamedAncestor })
      byCls.set(cls, (byCls.get(cls) ?? 0) + 1)
      const ex = exampleByCls.get(cls) ?? []
      if (ex.length < 4) {
        ex.push(
          `${label}:${s.line} xs:${s.kind} base="${s.base}" owner=${s.nearestNamedOwner ?? "(anonymous)"}` +
            `${s.binding ? ` binding=${s.binding}` : ""}${s.anyNamedAncestor && !s.nearestNamedOwner ? ` (named ancestor: ${s.anyNamedAncestor})` : ""}`,
        )
        exampleByCls.set(cls, ex)
      }
    }
    tree.delete?.()
  }
}

siteWorker()
console.error(`phase 2: ${sites.length} derivation sites, ${unparsedFiles.length} files with no tree`)

const cls = (k: Cls) => byCls.get(k) ?? 0
const covered = cls("A-covered") + cls("J-covered-collapsed")
const refusedTotal = sites.length - covered
const builtinNames = XSD_BUILTIN_TYPE_NAMES.size
const vocabCount = DECLARATION_VOCABULARIES.size

// Edges with no site behind them: matched on file + derivation kind + base qname.
// ── THE SOURCE-AUTHENTICITY LEDGER ──────────────────────────────────────────
//
// Everything above asks whether a SITE produced an edge. This asks the question the
// whole exercise turned up: is the edge's SOURCE a real declared type?
//
// `src/ast/real-xml-analyzer.ts:908-925` extracts an element's attributes with
// `ownerName = symbolName`, and line 824 computes `symbolName = declaredName ?? name` —
// the tag's own text when the element carries no `name`. That is CORRECT for the
// attributes that matter elsewhere: `type="T"` on `<xs:element name="x" type="T">`
// really does belong to `x`. It is WRONG for `base="B"`, because an XSD derivation
// element is not a named entity — it is a type CONSTRUCTOR, and the thing being derived
// is its nearest ancestor that declares a name.
//
// The consequence is measurable and it is a fabricated endpoint, which the lane brief
// calls the most expensive mistake available:
//
//   FSharp.Data/docs/data/po.xsd:71   <xs:simpleType name="SKU">
//                                        <xs:restriction base="xs:string">
//     emitted  "xs:restriction" -> "string"      the schema element, not `SKU`
//     correct  "SKU"            -> "string"
//     and a symbol literally named `xs:restriction` is published to hang it on.
//
// So each edge's source is classified by whether it is a name the file DECLARES or a name
// the file merely CONTAINS as a tag. A source in the second class is fabricated.
const XSD_CONSTRUCTOR_LOCALS = new Set([
  "schema", "element", "attribute", "complexType", "simpleType", "restriction", "extension",
  "complexContent", "simpleContent", "sequence", "choice", "all", "group", "attributeGroup",
  "any", "anyAttribute", "list", "union", "notation", "annotation", "documentation", "appinfo",
  "import", "include", "redefine", "override", "key", "keyref", "unique", "field", "selector",
  "assert", "alternative", "defaultOpenContent", "openContent", "anyAttribute",
])
const stripPrefix = (q: string): string => {
  const colon = q.indexOf(":")
  return colon >= 0 ? q.slice(colon + 1) : q
}

type SrcCls = "declared-in-file" | "xsd-constructor" | "other-undeclared"
const srcByCls = new Map<SrcCls, number>()
const srcExamples = new Map<SrcCls, string[]>()
const fabricated: string[] = []
const classifySource = (src: string): SrcCls => {
  const declared = declaredByFile.get(currentFile)
  if (declared && declared.has(src)) return "declared-in-file"
  const local = stripPrefix(src)
  if (XSD_CONSTRUCTOR_LOCALS.has(local)) return "xsd-constructor"
  return "other-undeclared"
}

let currentFile = ""
for (const [file, list] of edgesByFile) {
  currentFile = file
  for (const e of list) {
    const cls = classifySource(e.from)
    srcByCls.set(cls, (srcByCls.get(cls) ?? 0) + 1)
    const ex = srcExamples.get(cls) ?? []
    if (ex.length < 5) {
      ex.push(`${file}:${e.line ?? "?"}  "${e.from}" -> "${e.to}"  (${e.derivation} ${e.qname}, resolvable=${e.resolvable})`)
      srcExamples.set(cls, ex)
    }
    if (cls !== "declared-in-file") fabricated.push(`${file}:${e.line ?? "?"}  "${e.from}" -> "${e.to}"  source is ${cls}`)
  }
}
const srcCls = (k: SrcCls) => srcByCls.get(k) ?? 0
const fabricatedTotal = srcCls("xsd-constructor") + srcCls("other-undeclared")

// ── WHY `extends` RESOLVES LOW, AS A NUMBER RATHER THAN AN EXCUSE ─────────────
//
// The census reports `extends` both-ends resolution at 31.3%, and the obvious reading
// is that the edges are broken. They are not, and the reason has to be measured rather
// than argued, because "the targets are built-ins" is exactly the kind of sentence that
// makes a low number acceptable.
//
// `resolvable` is the analyzer's own four-way classification of the BASE: `in-document`
// (this file declares it), `builtin` (XSD Part 2 / the XML namespace declares it),
// `external` (an `xs:import` brought the namespace in) and `unresolved` (a bare value
// this file cannot satisfy). A BUILT-IN base is a real, declared type — in a
// specification rather than in this file — and the analyzer deliberately publishes no
// symbol for one, because inventing `string` as a declaration of this document is the
// M60.R10 fabrication the reference pass already refuses elsewhere. So every builtin-base
// edge has an endpoint that will never resolve, BY DESIGN.
//
// The split is therefore the measurement: resolution is expected to be high on the
// in-document share and low on the builtin share, and a high builtin share is a property
// of XSD, not a defect.
const resolvableByClass = new Map<string, { edges: number; targetIsSymbol: number; sourceIsSymbol: number }>()
const targetSymbolsByFile = new Map<string, Set<string>>()
currentFile = ""
for (const [file, list] of edgesByFile) {
  currentFile = file
  const syms = declaredByFile.get(file)
  for (const e of list) {
    const row = resolvableByClass.get(e.resolvable) ?? { edges: 0, targetIsSymbol: 0, sourceIsSymbol: 0 }
    row.edges++
    const declared = declaredByFile.get(file)
    if (declared && declared.has(e.to)) row.targetIsSymbol++
    if (declared && declared.has(e.from)) row.sourceIsSymbol++
    resolvableByClass.set(e.resolvable, row)
  }
}
// ── THE SAME QUESTION ASKED OF `calls` ───────────────────────────────────────
//
// The `extends` fabrication was found by asking whether an edge's SOURCE is a name the
// document declares. That question is type-independent and it has not been asked of
// `calls`, which resolves at 100 % at both ends on every corpus draw — a rate that says
// nothing about whether the source is a real template, because the analyzer mints a
// symbol for whatever name an edge needs. `calls` is also the type the lane brief holds
// up as the counterexample to "a high firing score is correctness" (powershell
// published a wildcard as a symbol name), so it is the type most worth asking twice.
//
// An `xsl:call-template`'s caller is the nearest enclosing `xsl:template`; when the call
// sits inside an inline `<xsl:variable>` body there is no enclosing template and the
// caller is the variable. Both are named by `name=`, and both are real, so the question
// is only whether the published source NAMES one of them or names a vocabulary tag.

type CallCls = "declared-caller" | "xslt-constructor" | "bare-undeclared"
const callsByCls = new Map<CallCls, { edges: number; examples: string[] }>()
const bumpCall = (c: CallCls, ex: string): void => {
  const row = callsByCls.get(c) ?? { edges: 0, examples: [] }
  row.edges++
  if (row.examples.length < 5) row.examples.push(ex)
  callsByCls.set(c, row)
}
const callCls = (k: CallCls) => callsByCls.get(k)?.edges ?? 0

//
// A source is FABRICATED when it carries a prefix the file binds to the XSLT namespace —
// `xsl:for-each` and `xsl:if` are vocabulary tags just as much as `xsl:template` is, and
// the first version of this classifier only recognised the five CALLER_ELEMENTS, so it
// filed 422 real fabrications under `unresolvable-caller` and reported 73. The prefix
// test is the right one because it needs no list: a name published with the vocabulary's
// own prefix cannot be a name the document declared, since a declared XSLT name is the
// `name=` attribute's VALUE and never carries a prefix.
for (const [file, list] of callsByFile) {
  const declared = declaredXslNamesByFile.get(file)
  const xsltPrefixes = xsltPrefixesByFile.get(file) ?? new Set<string>()
  for (const e of list) {
    const ex = `${file}:${e.line ?? "?"}  "${e.from}" -> "${e.to}"`
    const q = splitQName(e.from)
    if (declared && declared.has(e.from)) bumpCall("declared-caller", ex)
    else if (q.prefix.length > 0 && xsltPrefixes.has(q.prefix)) bumpCall("xslt-constructor", ex)
    else bumpCall("bare-undeclared", ex)
  }
}
const callsTotal = [...callsByFile.values()].reduce((a, l) => a + l.length, 0)
const callsFabricated = callCls("xslt-constructor")

// ── REFERENCES SOURCE AUTHENTICITY ───────────────────────────────────────────
//
// The same question, the third type. `references` resolves at 49.1% on the census draw
// against CSS's 66.8%, and the two `extends`/`calls` findings say a resolution rate is the
// wrong place to look for a fabricated endpoint: the analyzer mints a symbol for whatever
// name an edge needs, so an invented source RESOLVES. The source has to be asked directly.
//
// A source is `declared` when the file writes that name down on some element's `name=`
// attribute, any namespace — a deliberately wide superset, since a `references` source is
// often an ordinary application element and the only question here is whether the name is
// one the document wrote. Over-approximating declarations biases AGAINST calling a real
// source fabricated.
type RefCls = "declared-in-file" | "vocabulary-tag" | "undeclared"
const refsByCls = new Map<RefCls, { edges: number; examples: string[] }>()
const bumpRef = (c: RefCls, ex: string): void => {
  const row = refsByCls.get(c) ?? { edges: 0, examples: [] }
  row.edges++
  if (row.examples.length < 5) row.examples.push(ex)
  refsByCls.set(c, row)
}
const refCls = (k: RefCls) => refsByCls.get(k)?.edges ?? 0
let refsTotal = 0
for (const [file, list] of refsByFile) {
  const declared = declaredAnywhereByFile.get(file)
  const vocab = vocabLocalsByFile.get(file) ?? new Set<string>()
  for (const e of list) {
    refsTotal++
    const ex = `${file}  "${e.from}" -> "${e.to}"  (role=${e.role}, resolvable=${e.resolvable})`
    const isVocabularyElement =
      vocab.has(XSD_NS + "\u0000" + stripPrefix(e.from)) || vocab.has(XSLT_NS + "\u0000" + stripPrefix(e.from))
    if (declared && declared.has(e.from)) bumpRef("declared-in-file", ex)
    else if (isVocabularyElement) bumpRef("vocabulary-tag", ex)
    else bumpRef("undeclared", ex)
  }
}
const refsFabricated = refCls("vocabulary-tag")

// WHY THE CLASS IS NOT ZERO. A residual vocabulary-tag source is a site where NO
// named declaration is in scope at all, so there is no declarer to name and the
// analyzer falls back to the enclosing element. The histogram is over the ROLE that
// carried the edge, because the roles decide whether such a site can exist: a
// `match=`-dispatched XSLT template has no `name` (XSLT 1.0 §5.4), and an
// instruction at stylesheet top level is not inside any template at all. Counting
// without this would let 111 be read as "111 more bugs" rather than "111 sites the
// language gives no name to".
const residualByRole = new Map<string, number>()
for (const [file, list] of refsByFile) {
  const declared = declaredAnywhereByFile.get(file)
  const vocab = vocabLocalsByFile.get(file) ?? new Set<string>()
  for (const e of list) {
    if (declared && declared.has(e.from)) continue
    if (!vocab.has(XSD_NS + "\u0000" + stripPrefix(e.from)) && !vocab.has(XSLT_NS + "\u0000" + stripPrefix(e.from))) continue
    residualByRole.set(e.role, (residualByRole.get(e.role) ?? 0) + 1)
  }
}

const siteKeys = new Set(sites.map((s) => `${s.file} ${s.kind} ${s.base}`))
const orphanEdges: string[] = []
for (const [file, list] of edgesByFile) {
  for (const e of list) {
    if (!siteKeys.has(`${file} ${e.derivation} ${e.qname}`)) orphanEdges.push(`${file}: derivation=${e.derivation} qname="${e.qname}" from=${e.from}`)
  }
}

const report = {
  instrument: "derivation-accounting — coverage ledger, NOT an oracle",
  question: "1,652 derivation sites on the parse tree produced 438 extends edges. Which sites produced no edge, and why?",
  corpus: { root: CR, discovered: admittedTotal, walked: admitted.length, workers: WORKERS, admission: "git ls-files tracked only, <= 512 KiB, detectLanguageFromPath(abs, text) === 'xml' — copied from script/m14/ontology-coverage-gate.ts:201-213 so the populations are the same sample" },
  constants: {
    BUILTIN_NAMESPACE_URIS: BUILTIN_NAMESPACE_URIS.size,
    XSD_BUILTIN_TYPE_NAMES: builtinNames,
    DECLARATION_VOCABULARIES: vocabCount,
    source: "read off RealXmlAnalyzer at run time (TypeScript `private` is erased), not copied or scraped",
  },
  sites: { total: sites.length, files: new Set(sites.map((s) => s.file)).size },
  edges: { total: totalEdges, files: edgesByFile.size },
  byClass: {
    "A-covered": cls("A-covered"),
    "J-covered-collapsed": cls("J-covered-collapsed"),
    "I-anonymous-owner": cls("I-anonymous-owner"),
    "E-bare-nonvocabulary": cls("E-bare-nonvocabulary"),
    "F-prefixed-unimported": cls("F-prefixed-unimported"),
    "G-prefixed-unbound": cls("G-prefixed-unbound"),
    "H-bare-undeclared": cls("H-bare-undeclared"),
  },
  refusedTotal,
  coverageRatio: sites.length === 0 ? 0 : Number((covered / sites.length).toFixed(4)),
  edgeAccounting: {
    sitesCoveringAnEdge: covered,
    distinctEdges: totalEdges,
    edgesWithNoSiteBehindThem: orphanEdges.length,
    orphanExamples: orphanEdges.slice(0, 8),
    note: "sites > edges is EXPECTED and not a defect on its own: a `derivation` edge is emitted per candidate, and XSD permits repeated `base` values across one file that collapse to the same (from, to) pair. The load-bearing row is edgesWithNoSiteBehindThem, which would be an edge with no parse-tree fact under it.",
  },
  resolutionByResolvableClass: {
    question: "is `extends` low both-ends resolution a defect, or a property of XSD bases being BUILT-IN types this document does not declare?",
    note: "targetIsSymbol is measured against the names the FILE declares. A builtin base is declared by XSD Part 2, not by this file, so it is expected to read false here and the edge is still true.",
    byResolvable: Object.fromEntries([...resolvableByClass.entries()].map(([k, v]) => [k, {
      ...v,
      sourceIsDeclaredRate: v.edges === 0 ? 0 : Number((v.sourceIsSymbol / v.edges).toFixed(4)),
      targetIsDeclaredRate: v.edges === 0 ? 0 : Number((v.targetIsSymbol / v.edges).toFixed(4)),
    }])),
  },
  sourceAuthenticity: {
    question: "is each extends edge's SOURCE a name the document DECLARES, or a schema element's tag name the analyzer fell back to?",
    byClass: {
      "declared-in-file": srcCls("declared-in-file"),
      "xsd-constructor": srcCls("xsd-constructor"),
      "other-undeclared": srcCls("other-undeclared"),
    },
    fabricatedSources: fabricatedTotal,
    fabricatedRatio: totalEdges === 0 ? 0 : Number((fabricatedTotal / totalEdges).toFixed(4)),
    mechanism: "src/ast/real-xml-analyzer.ts:824 computes symbolName = declaredName ?? name, and lines 908-925 pass that as the ownerName for the element's own attributes. For base= on an XSD derivation element there is no name=, so the owner becomes the tag text. The convention is right for type= on a named element and wrong for base=, whose owner is the nearest ANCESTOR that declares a name.",
    examplesByClass: Object.fromEntries([...srcExamples.entries()].map(([k, v]) => [k, v])),
    fabricatedExamples: fabricated.slice(0, 12),
  },
  callsSourceAuthenticity: {
    question: "the extends question asked of `calls`: is each calls edge's SOURCE a name the document DECLARES, or an XSLT vocabulary tag?",
    note: "`calls` resolves at 100% at both ends on every draw, which says nothing about this: the analyzer mints a symbol for whatever name an edge needs. A variable IS a legitimate caller when a call sits in an inline variable body, so 'declared-caller' covers template, variable, param, function and with-param alike.",
    totalEdges: callsTotal,
    byClass: {
      "declared-caller": callCls("declared-caller"),
      "xslt-constructor": callsFabricated,
      "bare-undeclared": callCls("bare-undeclared"),
    },
    fabricatedRatio: callsTotal === 0 ? 0 : Number((callsFabricated / callsTotal).toFixed(4)),
    examplesByClass: Object.fromEntries([...callsByCls.entries()].map(([k, v]) => [k, v.examples])),
  },
  callsSiteLedger: {
    question: "the fix dropped 146 calls edges (548 -> 402). Every xsl:call-template carrying a name is counted on the parse tree and classified, so the drop is a COUNT and not a rationale.",
    byClass: Object.fromEntries([...callSitesByCls.entries()].map(([k, v]) => [k, { sites: v.sites, files: v.files }])),
    totalSites: [...callSitesByCls.values()].reduce((a2, v) => a2 + v.sites, 0),
    publishedEdges: callsTotal,
    sitesRepresentedByOccurrences: callsOccurrences,
    acceptedSites: callSitesByCls.get("covered-callee-declared")?.sites ?? 0,
    acceptedSitesMinusRepresented: (callSitesByCls.get("covered-callee-declared")?.sites ?? 0) - callsOccurrences,
    note: "A site with no named caller is one calls must NOT publish: XSLT 1.0 §2.4 does not permit an instruction sequence at stylesheet top level, so there is no caller to name. The `covered` count is expected to EXCEED the published edge count, because edge identity is the triple (source, type, target) and several sites in one template calling the same callee collapse.",
    examplesByClass: Object.fromEntries([...callSitesByCls.entries()].map(([k, v]) => [k, v.examples])),
  },
  referencesSourceAuthenticity: {
    question: "the extends/calls question asked of `references`, which resolves at 49.1% here against CSS's 66.8%. A resolution rate is the wrong instrument: a minted source resolves perfectly, so the source is asked directly.",
    note: "'declared-in-file' means the file writes that name on SOME element's name= attribute, any namespace — a wide superset, since a references source is often an ordinary application element. Over-approximating declarations biases AGAINST calling a real source fabricated. 'undeclared' is NOT asserted to be wrong: a references source may legitimately be an element the document only CONTAINS (the analyzer publishes inline elements as symbols), so this class is reported, not judged. 'vocabulary-tag' requires an element in the XSD or XSLT namespace with that local name to be PRESENT IN THIS FILE; deciding it from a list of local names is what the first version did, and it filed db2-templates.xml's ordinary `<template name=...>` element as an XSLT tag.",
    totalEdges: refsTotal,
    byClass: {
      "declared-in-file": refCls("declared-in-file"),
      "vocabulary-tag": refsFabricated,
      "undeclared": refCls("undeclared"),
    },
    fabricatedRatio: refsTotal === 0 ? 0 : Number((refsFabricated / refsTotal).toFixed(4)),
    residualByRole: Object.fromEntries([...residualByRole.entries()].sort((a, b) => b[1] - a[1])),
    residualNote: "the roles carrying the 111 edges that still name a vocabulary tag. The re-base gives a reference the nearest NAMED declaration; a site with no named declaration in scope has none to name, and the fallback keeps the pre-existing value rather than refusing the edge. `xslt_named_template_reference` at stylesheet top level and `entity_reference` under a `match=`-dispatched template are that shape.",
    examplesByClass: Object.fromEntries([...refsByCls.entries()].map(([k, v]) => [k, v.examples])),
  },
  unparsedFiles: { count: unparsedFiles.length, examples: unparsedFiles.slice(0, 5) },
  examplesByClass: Object.fromEntries([...exampleByCls.entries()].map(([k, v]) => [k, v])),
  limitations: [
    "A coverage ledger, not a correctness oracle: it finds sites that produced no edge. It cannot decide whether an emitted edge is right.",
    "Class H is an UPPER bound: `declaredHere` counts only XSD declaration elements, a deliberate under-approximation of the analyzer's seven-place `declaredNames`. Under-approximating declarations can only move a site OUT of A into H, so it inflates H and never inflates A.",
    "A-prefixed binding that IS a builtin or IS imported, yet still unmatched, would land in H. That is a real shortfall and H is where to look for it.",
  ],
}
writeFileSync(OUT, JSON.stringify({ ...report, sites: { total: report.sites.total, files: report.sites.files }, allSites: sites }, null, 2))

console.log("")
console.log(`derivation sites on the tree : ${report.sites.total} across ${report.sites.files} files`)
console.log(`extends edges from parseFile: ${report.edges.total} across ${report.edges.files} files`)
console.log(`sites COVERED by an edge     : ${covered}  (${(report.coverageRatio * 100).toFixed(1)}%)`)
console.log(`sites REFUSED, no edge      : ${refusedTotal}`)
for (const k of ["A-covered", "J-covered-collapsed", "I-anonymous-owner", "E-bare-nonvocabulary", "F-prefixed-unimported", "G-prefixed-unbound", "H-bare-undeclared"] as Cls[]) {
  console.log(`  ${k.padEnd(24)} ${String(cls(k)).padStart(5)}`)
  for (const e of exampleByCls.get(k) ?? []) console.log(`      ${e}`)
}
console.log(`edges with NO site behind them: ${orphanEdges.length}  <- the load-bearing number`)
for (const e of orphanEdges.slice(0, 8)) console.log(`      ${e}`)
console.log(`files with no parse tree     : ${unparsedFiles.length}`)
console.log("")
console.log("SOURCE AUTHENTICITY — is each edge's source a DECLARED type, or a schema tag the analyzer fell back to?")
console.log(`  declared-in-file : ${srcCls("declared-in-file")}`)
console.log(`  xsd-constructor  : ${srcCls("xsd-constructor")}   <- fabricated: the source is an XSD element's own tag name`)
console.log(`  other-undeclared : ${srcCls("other-undeclared")}`)
console.log(`  FABRICATED TOTAL : ${fabricatedTotal} of ${totalEdges}  (${(fabricatedTotal / Math.max(1, totalEdges) * 100).toFixed(1)}%)`)
for (const k of ["declared-in-file", "xsd-constructor", "other-undeclared"] as SrcCls[]) {
  for (const e of srcExamples.get(k) ?? []) console.log(`      [${k}] ${e}`)
}
console.log("")
console.log("RESOLUTION BY RESOLVABLE CLASS — is extends' low both-ends rate a defect or a property of XSD built-ins?")
for (const [k, v] of [...resolvableByClass.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(`  resolvable=${k.padEnd(12)} edges=${String(v.edges).padStart(5)}  source declared in file ${(v.sourceIsSymbol / v.edges * 100).toFixed(1)}%  target declared in file ${(v.targetIsSymbol / v.edges * 100).toFixed(1)}%`)
}
console.log("")
console.log("CALLS SOURCE AUTHENTICITY — the same question, asked of the type that resolves 100% and therefore looks safest")
console.log(`  declared-caller    : ${callCls("declared-caller")}`)
console.log(`  bare-undeclared   : ${callCls("bare-undeclared")}`)
console.log(`  xslt-constructor   : ${callsFabricated}   <- fabricated: the source is an XSLT vocabulary tag`)
console.log(`  of ${callsTotal} calls edges`)
for (const [k, v] of callsByCls) for (const e of v.examples.slice(0, 3)) console.log(`      [${k}] ${e}`)
console.log("")
console.log("CALL-SITE LEDGER — the 146 dropped calls edges, counted rather than argued")
for (const [k, v] of callSitesByCls) console.log(`  ${k.padEnd(18)} sites=${String(v.sites).padStart(4)}  files=${v.files}`)
console.log(`  total xsl:call-template sites on the tree: ${[...callSitesByCls.values()].reduce((a2, v) => a2 + v.sites, 0)}   published calls edges: ${callsTotal}`)
console.log(`  ACCEPTED sites ${callSitesByCls.get("covered-callee-declared")?.sites ?? 0}  vs  sum(metadata.occurrences) ${callsOccurrences}  ->  ${(callSitesByCls.get("covered-callee-declared")?.sites ?? 0) - callsOccurrences} unrepresented  <- must be 0`)
for (const [k, v] of callSitesByCls) for (const e of v.examples.slice(0, 3)) console.log(`      [${k}] ${e}`)
console.log("")
console.log("REFERENCES SOURCE AUTHENTICITY — the third type, and the one that resolves lowest")
console.log(`  declared-in-file : ${refCls("declared-in-file")}`)
console.log(`  vocabulary-tag   : ${refsFabricated}   <- fabricated`)
console.log(`      by role: ${JSON.stringify(Object.fromEntries([...residualByRole.entries()].sort((a, b) => b[1] - a[1])))}`)
console.log(`  undeclared       : ${refCls("undeclared")}   (reported, not judged: a source may be an element the file only CONTAINS)`)
console.log(`  of ${refsTotal} references edges`)
for (const [k, v] of refsByCls) for (const e of v.examples.slice(0, 3)) console.log(`      [${k}] ${e}`)
console.log(`\nwrote ${path.relative(process.cwd(), OUT)}`)