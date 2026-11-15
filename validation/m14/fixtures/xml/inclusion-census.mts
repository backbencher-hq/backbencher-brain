/**
 * INCLUSION CENSUS — the `part_of` construct and its neighbours, measured over the WHOLE
 * admitted population.
 *
 * ## THE QUESTION
 *
 * XML has two vocabularies that say "splice the named document's content INTO this one":
 * XInclude (`<xi:include href="…"/>`, XInclude 1.0 §4.1) and XSLT's stylesheet inclusion
 * (`<xsl:include href="…"/>`, XSLT 1.0 §2.6.1). Both are the `part_of` contract — the
 * included document is a fragment that shares the including document's single scope and
 * cannot be resolved as a separate unit. This instrument answers the numbers a
 * declaration has to carry, PER CHANNEL:
 *
 *   1. How many inclusion SITES exist, in how many files?
 *   2. Of those, how many `href` targets name an ADMITTED file (git-tracked, routed
 *      extension, under the size cap) — the class the arbiter can confirm.
 *   3. How many name something ABSENT or not admitted — the wall the declaration carries.
 *
 * It also measures the NEIGHBOURS, because a ruling is only honest if the thing next to
 * it was counted: `xsl:import` (a module import with precedence → `imports`, never
 * `part_of`), RELAX NG `<include href>` (a schema merge), the pre-REC 2003 XInclude
 * namespace, and `<include>` in no namespace.
 *
 * ## THE POPULATION
 *
 * Every git repository under the corpus root, `git ls-files` tracked only, <= 512 KiB,
 * with an extension the ROUTER gives this lane (`.xml .xsd .dtd .svg .xsl .xslt .rng`).
 * The `.corpus/<repo>` entries are SYMLINKS to the real repositories, so the walk `stat`s
 * each entry (following the link) rather than relying on lstat — the symlinked-directory
 * lesson, and the reason a `withFileTypes` walk here found 3 repos where the gate finds 127.
 *
 * ## WHY THE TREE, NOT THE TEXT, DECIDES WHICH ELEMENT IS WHICH
 *
 * Detection is by RESOLVED NAMESPACE and element name, never by the written prefix:
 * `xi` and `xsl` are conventions, and a vocabulary can be bound to any prefix or to the
 * default namespace. So a text-level screen only produces CANDIDATES; each candidate is
 * parsed and the namespace is resolved from the document's own `xmlns` declarations,
 * exactly as the analyzer does.
 *
 * ## THE CROSS-CHECK THAT MAKES THIS A MEASUREMENT AND NOT A COPY
 *
 * The census walks the tree itself for the counts, and it ALSO runs the analyzer on the
 * same files and sums the `part_of` / `imports` occurrences it emits, PER ROLE. If they
 * disagree the artifact prints both numbers and `agrees` goes false — a measurement that
 * cannot call the thing it measures must at least be compared against it.
 *
 * ## RUN
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus npx tsx validation/m14/fixtures/xml/inclusion-census.mts
 *
 * Writes `inclusion-census.json` beside itself (the lane's evidence convention: a
 * citation must resolve to a TRACKED file).
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

const ROOT = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const EXTS = new Set(["xml", "xsd", "dtd", "svg", "xsl", "xslt", "rng"])
const CAP = 512 * 1024
const XINCLUDE_NS = "http://www.w3.org/2001/XInclude"
const XINCLUDE_DRAFT_2003_NS = "http://www.w3.org/2003/XInclude"
const XSLT_NS = "http://www.w3.org/1999/XSL/Transform"
const RNG_NS = "http://relaxng.org/ns/structure/1.0"

/**
 * Candidate screen: any element whose local name is `include` or `import` and which
 * carries an href. A cheap SUPERSET — any false positive is parsed and dropped by the
 * namespace test; a false negative would LOSE a site, so the screen is deliberately loose.
 */
function isInclusionCandidate(text: string): boolean {
  return /<\s*(?:[\w.-]+:)?(?:include|import)\b[^<>]*\bhref\s*=/i.test(text)
}

type Site = {
  repo: string
  rel: string
  namespace: string | null
  elementName: string
  localName: string
  href: string
  parseMode: string
  line: number
}

type ClassCounts = Record<string, number>

type Channel = {
  /** The relationship the analyzer emits, or "none" for a measured non-emission. */
  emits: "part_of" | "imports" | "none"
  /** The key the analyzer's own rows are counted under, for the cross-check. */
  role?: string
  /** Why a NON-emitting channel is not part_of. */
  why?: string
}

const CHANNELS: Record<string, Channel> = {
  xinclude_include: { emits: "part_of", role: "xinclude_part" },
  xslt_include: { emits: "part_of", role: "xslt_include_part" },
  xslt_import: { emits: "imports", role: "xslt_stylesheet_import" },
  rng_include: {
    emits: "none",
    why: "RELAX NG's <include href> merges another schema's DEFINITIONS into this schema; it is the schema-merge relation XSD's xs:include/schemaLocation already carries as `imports`, not a textual splice of content, so it is not part_of",
  },
  xinclude_draft_2003: {
    emits: "none",
    why: "the pre-REC 2003 XInclude namespace is a Working-Draft spelling; the XInclude 1.0 REC namespace is the 2001 URI, and the one corpus site is displayed example text, not a live inclusion",
  },
  no_namespace: {
    emits: "none",
    why: "an element whose local name is include/import outside every inclusion vocabulary is not an inclusion directive",
  },
}

function channelOf(ns: string | null, local: string): string {
  if (local === "import") return ns === XSLT_NS ? "xslt_import" : "no_namespace"
  if (ns === XINCLUDE_NS) return "xinclude_include"
  if (ns === XSLT_NS) return "xslt_include"
  if (ns === RNG_NS) return "rng_include"
  if (ns === XINCLUDE_DRAFT_2003_NS) return "xinclude_draft_2003"
  return "no_namespace"
}

async function main() {
  // ── the admitted set, and where each admitted path lives ─────────────────────
  const repos: string[] = []
  for (const entry of readdirSync(ROOT)) {
    const p = path.join(ROOT, entry)
    let st
    try { st = statSync(p) } catch { continue } // stat FOLLOWS the .corpus symlink
    if (!st.isDirectory()) continue
    try { statSync(path.join(p, ".git")); repos.push(entry) } catch { /* not a repo root */ }
  }

  const admittedByRepo = new Map<string, Set<string>>()
  let admitted = 0
  for (const repo of repos) {
    let files: string[]
    try {
      files = execSync(`git -C ${JSON.stringify(path.join(ROOT, repo))} ls-files`, {
        encoding: "utf8",
        maxBuffer: 1 << 28,
      }).split("\n").map((s) => s.trim()).filter(Boolean)
    } catch { continue }
    const set = new Set<string>()
    for (const rel of files) {
      const ext = rel.slice(rel.lastIndexOf(".") + 1)
      if (!EXTS.has(ext)) continue
      let st
      try { st = statSync(path.join(ROOT, repo, rel)) } catch { continue }
      if (!st.isFile() || st.size > CAP) continue
      set.add(rel)
      admitted++
    }
    admittedByRepo.set(repo, set)
  }

  // ── the candidates ──────────────────────────────────────────────────────────
  const candidates: { repo: string; rel: string; abs: string }[] = []
  for (const repo of repos) {
    for (const rel of admittedByRepo.get(repo) ?? []) {
      const abs = path.join(ROOT, repo, rel)
      let text: string
      try { text = readFileSync(abs, "utf8") } catch { continue }
      if (isInclusionCandidate(text)) candidates.push({ repo, rel, abs })
    }
  }

  // ── parse each candidate and read each element's resolved NAMESPACE ─────────
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const sites: Site[] = []
  let parsedCandidates = 0

  for (const cand of candidates) {
    let text: string
    try { text = readFileSync(cand.abs, "utf8") } catch { continue }
    const tree = parser.parse(text)
    if (!tree) continue
    parsedCandidates++
    const bindings = new Map<string, string>([["xml", "http://www.w3.org/XML/1998/namespace"]])
    const visit = (node: any) => {
      if (node.type === "element") {
        const tag = node.children?.find((c: any) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
        const nameNode = tag?.children?.find((c: any) => c?.type === "Name")
        const written = nameNode?.text?.trim() ?? ""
        const colon = written.indexOf(":")
        const prefix = colon >= 0 ? written.slice(0, colon) : ""
        const local = colon >= 0 ? written.slice(colon + 1) : written
        // Bind this element's namespaces BEFORE resolving its own name, so
        // `<include xmlns="…/XInclude" href=…/>` resolves on the SAME element. Each
        // binding remembers what it SHADOWED so leaving restores the outer scope.
        const added: [string, string | undefined][] = []
        if (tag) {
          for (let i = 0; i < tag.namedChildCount; i++) {
            const attr = tag.namedChild(i)
            if (attr?.type !== "Attribute") continue
            const an = attr.children?.find((c: any) => c?.type === "Name")?.text?.trim() ?? ""
            const av = attr.children?.find((c: any) => c?.type === "AttValue")?.text?.trim() ?? ""
            const value = av.length >= 2 && (av[0] === '"' || av[0] === "'") ? av.slice(1, -1) : av
            if (an === "xmlns") { added.push(["", bindings.get("")]); bindings.set("", value) }
            else if (an.startsWith("xmlns:")) { const p = an.slice(6); added.push([p, bindings.get(p)]); bindings.set(p, value) }
          }
        }
        if (local === "include" || local === "import") {
          const ns = bindings.get(prefix) ?? (colon < 0 ? bindings.get("") : undefined) ?? null
          let href = ""
          let parseMode = "xml"
          let hrefLine = node.startPosition.row + 1
          for (let i = 0; i < (tag?.namedChildCount ?? 0); i++) {
            const attr = tag.namedChild(i)
            if (attr?.type !== "Attribute") continue
            const an = attr.children?.find((c: any) => c?.type === "Name")?.text?.trim() ?? ""
            const av = attr.children?.find((c: any) => c?.type === "AttValue")?.text?.trim() ?? ""
            const value = av.length >= 2 && (av[0] === '"' || av[0] === "'") ? av.slice(1, -1) : av
            if (an === "href") { href = value; hrefLine = attr.startPosition.row + 1 }
            if (an === "parse") parseMode = value
          }
          sites.push({ repo: cand.repo, rel: cand.rel, namespace: ns, elementName: written, localName: local, href, parseMode, line: hrefLine })
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
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(tree.rootNode)
  }

  // ── per-channel href classification ─────────────────────────────────────────
  const byChannel: Record<string, any> = {}
  for (const name of Object.keys(CHANNELS)) {
    byChannel[name] = { ...CHANNELS[name], sites: 0, files: 0, hrefClasses: { admitted: 0, "exists-not-admitted": 0, absent: 0, remote: 0, empty: 0 }, parseModes: {}, sitesDetail: [] as any[] }
  }

  for (const s of sites) {
    const ch = channelOf(s.namespace, s.localName)
    const bucket = byChannel[ch]
    bucket.sites++
    const href = s.href.trim()
    let cls: string
    if (href.length === 0) cls = "empty"
    else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) cls = "remote"
    else {
      let pathPart = href
      const hash = pathPart.indexOf("#")
      if (hash >= 0) pathPart = pathPart.slice(0, hash)
      const query = pathPart.indexOf("?")
      if (query >= 0) pathPart = pathPart.slice(0, query)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(s.rel), pathPart))
      const set = admittedByRepo.get(s.repo)
      if (set?.has(resolved)) cls = "admitted"
      else {
        let exists = false
        try { exists = statSync(path.join(ROOT, s.repo, resolved)).isFile() } catch { exists = false }
        cls = exists ? "exists-not-admitted" : "absent"
      }
    }
    bucket.hrefClasses[cls] = (bucket.hrefClasses[cls] ?? 0) + 1
    bucket.parseModes[s.parseMode] = (bucket.parseModes[s.parseMode] ?? 0) + 1
    bucket.sitesDetail.push({ file: `${s.repo}/${s.rel}`, href, class: cls, parseMode: s.parseMode, line: s.line, namespace: s.namespace })
  }
  // files per channel, and the DECLARED REFUSALS each channel's rule applies. An emission
  // count is a claim about what the rule emits, so the refusals are named here rather than
  // left to make the cross-check disagree: a REMOTE href is refused on the same rule the
  // `imports` edges use (a file claim outside the project cannot be confirmed), and an
  // EMPTY href names no file at all.
  for (const name of Object.keys(byChannel)) {
    const files = new Set<string>((byChannel[name].sitesDetail as any[]).map((d) => d.file))
    byChannel[name].files = files.size
    const refusedRemote = byChannel[name].hrefClasses.remote ?? 0
    const refusedEmpty = byChannel[name].hrefClasses.empty ?? 0
    byChannel[name].refused = { remote: refusedRemote, empty: refusedEmpty }
    byChannel[name].expectedOccurrences = byChannel[name].sites - refusedRemote - refusedEmpty
  }

  // ── the analyzer's own rows, PER ROLE — the cross-check ─────────────────────
  const { RealXmlAnalyzer } = await import("../../../../src/ast/real-xml-analyzer")
  const analyzerRowsByRole: Record<string, number> = {}
  const analyzerOccByRole: Record<string, number> = {}
  for (const cand of candidates) {
    let text: string
    try { text = readFileSync(cand.abs, "utf8") } catch { continue }
    const tree = parser.parse(text)
    if (!tree) continue
    const result = new RealXmlAnalyzer().analyze(tree.rootNode, text, `${cand.repo}/${cand.rel}`)
    for (const r of result.relationships ?? []) {
      const role = String((r.metadata as any)?.role ?? "")
      if (r.type === "part_of" || role === "xslt_stylesheet_import") {
        const occ = Number((r.metadata as any)?.occurrences ?? 1)
        analyzerRowsByRole[role] = (analyzerRowsByRole[role] ?? 0) + 1
        analyzerOccByRole[role] = (analyzerOccByRole[role] ?? 0) + occ
      }
    }
    if (typeof (tree as any).delete === "function") (tree as any).delete()
  }

  const crossCheck: Record<string, any> = {}
  let allAgree = true
  for (const [name, cfg] of Object.entries(CHANNELS)) {
    if (!cfg.role) continue
    const bucket = byChannel[name]
    const rows = analyzerRowsByRole[cfg.role] ?? 0
    const occ = analyzerOccByRole[cfg.role] ?? 0
    // Sites MINUS the channel's declared refusals is what the rule must emit; a difference
    // from the analyzer's own total is a disagreement, and it is printed either way.
    const expected = bucket.expectedOccurrences as number
    const agrees = occ === expected
    if (!agrees) allAgree = false
    crossCheck[name] = {
      emittedAs: cfg.emits,
      role: cfg.role,
      analyzerRows: rows,
      analyzerOccurrences: occ,
      censusSites: bucket.sites,
      refused: bucket.refused,
      expectedOccurrences: expected,
      agrees,
    }
  }

  const out = {
    instrument: "validation/m14/fixtures/xml/inclusion-census.mts",
    population: {
      root: ROOT,
      repos: repos.length,
      admitted,
      admission: "git-tracked, <= 512 KiB, extension in the router's set (.xml .xsd .dtd .svg .xsl .xslt .rng)",
      candidatesScreened: candidates.length,
      candidatesParsed: parsedCandidates,
    },
    partOfChannels: {
      xinclude_include: byChannel.xinclude_include,
      xslt_include: byChannel.xslt_include,
      /** combined `part_of` population — the two channels are the same relation */
      combined: {
        sites: byChannel.xinclude_include.sites + byChannel.xslt_include.sites,
        files: new Set([...byChannel.xinclude_include.sitesDetail, ...byChannel.xslt_include.sitesDetail].map((d: any) => d.file)).size,
        hrefClasses: {
          admitted: byChannel.xinclude_include.hrefClasses.admitted + byChannel.xslt_include.hrefClasses.admitted,
          "exists-not-admitted": byChannel.xinclude_include.hrefClasses["exists-not-admitted"] + byChannel.xslt_include.hrefClasses["exists-not-admitted"],
          absent: byChannel.xinclude_include.hrefClasses.absent + byChannel.xslt_include.hrefClasses.absent,
          remote: byChannel.xinclude_include.hrefClasses.remote + byChannel.xslt_include.hrefClasses.remote,
          empty: byChannel.xinclude_include.hrefClasses.empty + byChannel.xslt_include.hrefClasses.empty,
        },
        refused: {
          remote: byChannel.xinclude_include.refused.remote + byChannel.xslt_include.refused.remote,
          empty: byChannel.xinclude_include.refused.empty + byChannel.xslt_include.refused.empty,
        },
        expectedOccurrences:
          byChannel.xinclude_include.expectedOccurrences + byChannel.xslt_include.expectedOccurrences,
      },
    },
    nearMissChannels: {
      xslt_import: byChannel.xslt_import,
      rng_include: byChannel.rng_include,
      xinclude_draft_2003: byChannel.xinclude_draft_2003,
      no_namespace: byChannel.no_namespace,
    },
    analyzerCrossCheck: {
      allAgree,
      perChannel: crossCheck,
      note: "Each channel's site count (census tree-walk) must equal the analyzer's summed occurrences for that channel's role. A disagreement is printed, never smoothed.",
    },
  }
  console.log(JSON.stringify(out, null, 2))
  writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "inclusion-census.json"), JSON.stringify(out, null, 2) + "\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
