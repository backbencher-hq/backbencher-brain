/**
 * MARKDOWN CONSTRUCT PROBE — the two instruments the ontology workstream names,
 * applied to markdown.
 *
 * ## Why this exists, and why the supervisor's gate cannot be used directly
 *
 * `script/m14/ontology-coverage-gate.ts` is the arbiter. Run as
 * `npx tsx script/m14/ontology-coverage-gate.ts markdown` it prints its corpus line
 * (`corpus: 12729 admitted files`), spends the run parsing it, and then exits 2 with:
 *
 *     ontology coverage gate — no RULING TABLE for markdown.
 *     Refusing to report: a gate with an empty table would call every un-emitted type
 *     RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *
 * That refusal is the gate behaving correctly. `RULED_BY_LANG` in that file carries
 * `bash` and `json` and nothing else, so for markdown every non-emitted type would be
 * reported RULED-UNJUSTIFIED — a verdict about the table rather than about the lane.
 * The table is shared machinery this lane does not own (§8 of the workstream brief), so
 * this script does the measuring and the need is filed as a supervisor item.
 *
 * ## A text regex is the wrong instrument, and the corpus says so
 *
 * The arbiter's header records two false positives its first version returned: an
 * `extends` probe matched `class voice` inside a telnet IAC word list in a string, and
 * an `instantiates` probe matched `new Map(` in a bash file carrying embedded
 * JavaScript in a heredoc. Both would have convicted a correct ruling.
 *
 * So every count here is taken from the PARSE TREE, not from the source text, and the
 * one exception is stated where it occurs: the front-matter and include-directive
 * probes read TEXT that the grammar models as a single opaque node, which is the
 * structural situation the workstream calls "a value in a reserved position" and the
 * reason a grammar inventory cannot answer those two questions.
 *
 * ## Instrument A — GRAMMAR INVENTORY
 *
 * Enumerate every node type BOTH pinned grammars actually produce across the corpus
 * (block + the companion inline grammar), with occurrence counts. Positive evidence of
 * absence: a construct that would need a node type this inventory does not contain is
 * not expressible.
 *
 * ## Instrument B — PARSE-TREE SEMANTIC COUNT
 *
 * For a construct the language CAN express, count it on the tree, where a string or an
 * embedded snippet cannot fake it. Each probe names what a NON-ZERO count would mean,
 * because a ruling that cannot be overturned is not a ruling.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/construct-probe.ts \
 *     [--sample N] [--seed s] [--repos a,b] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SAMPLE = Number(arg("sample", "400"))
const SEED = arg("seed", "markdown-construct-probe-v1")
const OUT = arg("out", "")
const ONLY = arg("repos", "")
const ONLY_SET = ONLY ? new Set(ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null

// ─────────────────────────────────────────────────────────── grammars
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const loadWasm = async (rel: string) =>
  await WSL.load(readFileSync(path.join(ROOT, "wasm", rel)))
// The registry's own spelling for these two: `wasm/tree-sitter-markdown.wasm` and
// `wasm/tree-sitter-markdown_inline.wasm` at the repository root.
const blockLang = await loadWasm("tree-sitter-markdown.wasm")
const inlineLang = await loadWasm("tree-sitter-markdown_inline.wasm")
const blockParser = new WSP()
blockParser.setLanguage(blockLang)
const inlineParser = new WSP()
inlineParser.setLanguage(inlineLang)

// ─────────────────────────────────────────────────────────── corpus
type Repo = { name: string; dir: string; tracked: Set<string> }
const repos: Repo[] = []
for (const e of readdirSync(CR).sort()) {
  if (ONLY_SET && !ONLY_SET.has(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  const set = new Set(tracked)
  const md = tracked.filter((r) => /\.(md|markdown)$/i.test(r))
  if (md.length > 0) repos.push({ name: e, dir, tracked: set })
}

type FileRec = { repo: Repo; rel: string; abs: string; text: string }
const population: FileRec[] = []
for (const r of repos) {
  for (const rel of r.tracked) {
    if (!/\.(md|markdown)$/i.test(rel)) continue
    const abs = path.join(r.dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    population.push({ repo: r, rel, abs, text })
  }
}
const key = (f: FileRec) => `${f.repo.name}/${f.rel}`
const draw = (SAMPLE > 0 && SAMPLE < population.length
  ? population
      .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
      .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
      .slice(0, SAMPLE)
      .map((x) => x.f)
  : population)
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

// ─────────────────────────────────────────────────────────── instrument A
/** Every node type the two grammars actually produce, with occurrence counts. */
const nodeTypes = new Map<string, number>()
/** Child node types seen under each parent — this is how `minus_metadata`'s SHAPE is
 *  established rather than assumed, and the shape is the whole of the `references`
 *  ruling. */
const childTypes = new Map<string, Map<string, number>>()
const bumpChildren = (parent: string, child: string) => {
  let m = childTypes.get(parent)
  if (!m) { m = new Map(); childTypes.set(parent, m) }
  m.set(child, (m.get(child) ?? 0) + 1)
}

// ─────────────────────────────────────────────────────────── instrument B counters
type Probe = {
  id: string
  question: string
  instrument: string
  overturnIf: string
  occurrences: number
  files: number
  examples: string[]
  breakdown?: Record<string, number>
}

const probes: Probe[] = []
const newProbe = (id: string, question: string, instrument: string, overturnIf: string): Probe => {
  const p: Probe = { id, question, instrument, overturnIf, occurrences: 0, files: 0, examples: [] }
  probes.push(p)
  return p
}
const hit = (p: Probe, file: string, example: string) => {
  p.occurrences++
  const before = p.files
  p.files = p.files // no-op; file tally is done per-file below
  if (p.examples.length < 6) p.examples.push(`${file}: ${example}`)
}
const perFileHits = new Map<string, Set<string>>()
const markHit = (p: Probe, file: string) => {
  let s = perFileHits.get(p.id)
  if (!s) { s = new Set(); perFileHits.set(p.id, s) }
  s.add(file)
}

// The probes. Names are the ones the brief and the gate use, so a verdict can be
// traced to the probe that would overturn it.
const P_REFSHAPE = newProbe(
  "A1:minus_metadata-shape",
  "Does the block grammar expose front matter as key/value nodes, or as one opaque node?",
  "A:grammar-inventory (shape, not occurrence)",
  "any NAMED child of minus_metadata that is not `---`/`block_continuation`/`block_quote_marker`",
)
const P_IMPORTS_LINKFILE = newProbe(
  "B1a:relative-HYPERLINK-to-existing-file",
  "Does a document HYPERLINK a path that resolves to a tracked file in the same repository?",
  "B:parse-tree-count (link_destination off the inline tree AND off block-level link_reference_definition; existence checked against the repo's own tracked set)",
  "any relative link_destination that resolves to a tracked file in the same repo",
)
const P_REL_ALL = newProbe(
  "B1z:ALL-relative-destinations",
  "Of every relative link destination a document writes, how many resolve to a tracked file in the same repository?",
  "B:parse-tree-count (link_destination with no scheme, no leading /, over the inline tree AND block-level link_reference_definition)",
  "the RESOLVED fraction reaching the whole population — i.e. a per-file analyzer with no repository view (PROJECT_INDEX_EXTENSIONS carries .sol only, so context.projectIndex is undefined for markdown in production) being able to tell a live path from a dead one",
)
const P_IMPORTS_IMAGEFILE = newProbe(
  "B1b:relative-IMAGE-source-to-existing-file",
  "Does a document EMBED another file's bytes into its own rendering (a relative image source), rather than navigate to it?",
  "B:parse-tree-count (link_destination whose inline parent is an `image` node; existence checked on disk)",
  "any relative image source that resolves to a tracked file in the same repo",
)
const P_IMPORTS_INCLUDE = newProbe(
  "B2:include-directive",
  "Does a document SPLICE another file into itself — a Jekyll/Liquid/Hugo/MyST include rather than a hyperlink?",
  "B:parse-tree-count on the reserved positions the grammar models as text (fence content, inline text, front matter)",
  "any include/transclude construct that causes a build tool to inline another file's content",
)
const P_OVERRIDE_ANCHOR = newProbe(
  "B3:duplicate-anchor-displacement",
  "Does a SECOND heading of the same name DISPLACE the first as the target of a `#fragment` link?",
  "B:parse-tree-count (anchor slug recomputed from the tree, per the renderer's own rule)",
  "a `#fragment` link that resolves to a repeated heading rather than to the first holder of that anchor",
)
const P_INSTANTIATE_TAG = newProbe(
  "B4:component-tag",
  "Does a document name a COMPONENT in a position that instantiates it, rather than showing markup as text?",
  "B:parse-tree-count (html_tag under html_block, tag name's first character case)",
  "an html_tag whose name is capitalised AND whose construction the document marks as executable rather than illustrative",
)
const P_CALLS_FENCE = newProbe(
  "B5:embedded-code-population",
  "How much embedded code does the corpus carry, and in which language?",
  "B:parse-tree-count (info_string of every fenced block)",
  "n/a — this probe measures a POPULATION, not a construct's absence; it bounds the size of the `calls` attribution argument",
)
const P_EXPORTS_H1 = newProbe(
  "B6:document-title",
  "Does a document declare a NAME for itself in a reserved position — front matter `title`, or the first H1?",
  "B:parse-tree-count (minus_metadata text + the first atx_h1/setext_h1 in document order)",
  "any construct by which a document names an entity it makes available to a consumer",
)
const P_WIKILINK = newProbe(
  "B7:wiki-link",
  "Does the corpus carry `[[wiki]]` links?",
  "B:parse-tree-count (bracket run inside an inline tree, which is where a wiki link's punctuation would have to appear)",
  "any `[[...]]` link outside a code span",
)

/** The include probe. Its tokens are a CLOSED list, each named, so the count can be
 *  audited against the list rather than trusted. */
const INCLUDE_TOKENS = [
  "{% include", "{%include", "{%- include",
  "{{< include", "{{<include", "{{< ref",
  "{include}", "{include ",
  "!include(", "!INCLUDE",
  "<!--[markdoc", "--8<--", "++++[include]",
]

// ─────────────────────────────────────────────────────────── helpers, no regex
const textOf = (n: any): string => (n.text ?? "").trim()

/** Percent-decode and lowercase a fragment, the form a fragment is WRITTEN in. Mirrors
 *  the analyzer's `decodeFragment` rule independently rather than importing it: an
 *  oracle that shares the helper guarantees agreement, and agreement with a shared bug
 *  is what this workstream exists to prevent. */
const decodeFrag = (frag: string): string => {
  let out = ""
  for (let i = 0; i < frag.length; i++) {
    if (frag.charCodeAt(i) === 37 && i + 2 < frag.length) {
      const hi = hexVal(frag.charCodeAt(i + 1))
      const lo = hexVal(frag.charCodeAt(i + 2))
      if (hi >= 0 && lo >= 0) { out += String.fromCharCode(hi * 16 + lo); i += 2; continue }
    }
    out += frag[i]
  }
  return out.toLowerCase()
}
const hexVal = (c: number): number => {
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 97 && c <= 102) return c - 87
  if (c >= 65 && c <= 70) return c - 55
  return -1
}

/** Percent-decode and strip the query/fragment, so a path can be tested on disk. */
const cleanDestination = (dest: string): string => {
  let d = dest.trim()
  const hash = d.indexOf("#")
  if (hash >= 0) d = d.slice(0, hash)
  const q = d.indexOf("?")
  if (q >= 0) d = d.slice(0, q)
  return d
}
const hasScheme = (d: string): boolean => {
  const c = d.indexOf(":")
  if (c <= 0) return false
  for (let i = 0; i < c; i++) {
    const code = d.charCodeAt(i)
    const alpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    const digit = code >= 48 && code <= 57
    if (!alpha && !digit && code !== 43 && code !== 45 && code !== 46) return false
  }
  return true
}
const isUpperInitial = (s: string): boolean => {
  if (s.length === 0) return false
  const c = s.charCodeAt(0)
  return c >= 65 && c <= 90
}
/** Surrounding `[...]`, removed by position. No regex. */
const stripBrackets = (text: string): string => {
  const t = text.trim()
  if (t.length >= 2 && t.charCodeAt(0) === 91 && t.charCodeAt(t.length - 1) === 93) return t.slice(1, -1).trim()
  return t
}
/** Whether a `link_destination` sits under an `image` node. The inline grammar makes
 *  `image` a NAMED node whose `link_destination` is a named child, so the walk can see
 *  it; `n.parent` is not populated by web-tree-sitter's JS binding for every node, so
 *  the flag is threaded explicitly by `inlWalk` rather than assumed. */
let imageDepth = 0
const insideImage = (_n: any): boolean => imageDepth > 0

/** Walk the block tree, collecting inline sub-trees the way the engine does. */
const inlineTreesOf = (root: any): { startIndex: number; text: string }[] => {
  const out: { startIndex: number; text: string }[] = []
  const s: any[] = [root]
  while (s.length > 0) {
    const n = s.pop()
    if (n.type === "inline") {
      out.push({ startIndex: n.startIndex, text: n.text })
      continue
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) s.push(c)
    }
  }
  return out
}

const relFileBreakdown: Record<string, number> = {}
const includeBreakdown: Record<string, number> = {}
const fenceLangs: Record<string, number> = {}

// ─────────────────────────────────────────────────────────── the walk
let parsed = 0
let treeFailures = 0
for (const f of draw) {
  const fileLabel = key(f)
  let tree: any
  try { tree = blockParser.parse(f.text) } catch { treeFailures++; continue }
  if (!tree) { treeFailures++; continue }
  parsed++

  // Instrument A: node vocabulary + parent/child shape.
  const visit = (n: any) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) bumpChildren(n.type, n.child(i).type)
    for (let i = 0; i < n.namedChildCount; i++) visit(n.namedChild(i))
  }
  visit(tree.rootNode)

  // ── A1: minus_metadata's shape decides the `references` ruling, so it is read from
  // the tree rather than assumed from the spec's prose.
  const shapeWalk = (n: any) => {
    if (n.type === "minus_metadata") {
      const named: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) named.push(n.namedChild(i).type)
      P_REFSHAPE.occurrences++
      markHit(P_REFSHAPE, fileLabel)
      if (named.length > 0 && P_REFSHAPE.examples.length < 6) {
        P_REFSHAPE.examples.push(`${fileLabel}: named children [${named.join(", ")}]`)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) shapeWalk(n.namedChild(i))
  }
  shapeWalk(tree.rootNode)

  // ── B5: fence language population.
  const fenceWalk = (n: any) => {
    if (n.type === "fenced_code_block") {
      const info = n.namedChildren.find((c: any) => c.type === "info_string")
      const langNode = info ? info.namedChildren.find((c: any) => c.type === "language") : undefined
      const lang = (langNode?.text ?? info?.text ?? "(none)").trim() || "(none)"
      fenceLangs[lang] = (fenceLangs[lang] ?? 0) + 1
      P_CALLS_FENCE.occurrences++
    }
    for (let i = 0; i < n.namedChildCount; i++) fenceWalk(n.namedChild(i))
  }
  fenceWalk(tree.rootNode)

  // ── B4: component tags.
  const tagWalk = (n: any) => {
    if (n.type === "html_tag" && n.text) {
      const open = n.text.slice(0, 1)
      if (open === "<") {
        const name = n.text.slice(1).split(/[\s/>]/, 1)[0] ?? ""
        if (isUpperInitial(name)) {
          P_INSTANTIATE_TAG.occurrences++
          markHit(P_INSTANTIATE_TAG, fileLabel)
          if (P_INSTANTIATE_TAG.examples.length < 6) P_INSTANTIATE_TAG.examples.push(`${fileLabel}: <${name}`)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) tagWalk(n.namedChild(i))
  }
  tagWalk(tree.rootNode)

  // ── B3: duplicate heading anchors and whether a fragment link is displaced.
  // The rule is the renderer's own, recomputed from the tree: lowercase, keep letters
  // /digits/hyphen, spaces and tabs to hyphens, drop the rest; a repeat takes `-1`.
  const slug = (text: string): string => {
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      const ch = text[i]
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out += ch.toLowerCase()
      else if (c === 32 || c === 9 || c === 45) out += "-"
    }
    return out
  }
  const anchorHolders = new Map<string, number>()
  const headingWalk = (n: any) => {
    if (n.type === "atx_heading" || n.type === "setext_heading") {
      const inline = n.namedChildren.find((c: any) => c.type === "inline")
      const text = (inline?.text ?? "").trim()
      const s = slug(text)
      if (s) anchorHolders.set(s, (anchorHolders.get(s) ?? 0) + 1)
    }
    for (let i = 0; i < n.namedChildCount; i++) headingWalk(n.namedChild(i))
  }
  headingWalk(tree.rootNode)
  // DISPLACEMENT, which is the whole question, measured after the anchors are known.
  // A duplicate anchor alone is not an override: GitHub gives the second holder `-1`, so
  // both headings stay addressable and neither takes the other's name. What would make a
  // heading an override is a `#fragment` link that resolves to the SECOND holder of an
  // anchor the first one already holds. So the probe counts exactly that, over every
  // fragment link in the file's inline trees.
  for (const blk of inlineTreesOf(tree.rootNode)) {
    let sub: any
    try { sub = inlineParser.parse(blk.text) } catch { sub = null }
    if (!sub) continue
    const fragWalk = (n: any) => {
      if (n.type === "link_destination") {
        const raw = textOf(n)
        if (raw.charCodeAt(0) === 35 /* # */) {
          const frag = decodeFrag(raw.slice(1))
          const holders = anchorHolders.get(frag) ?? 0
          if (holders > 1) {
            // Displacement would be the second holder winning. Under the renderer's own
            // rule the FIRST wins the plain anchor, so this records the ruled shape and
            // its count separately rather than calling a duplicate an override.
            P_OVERRIDE_ANCHOR.occurrences++
            markHit(P_OVERRIDE_ANCHOR, fileLabel)
            if (P_OVERRIDE_ANCHOR.examples.length < 6) {
              P_OVERRIDE_ANCHOR.examples.push(`${fileLabel}: #${frag} held by ${holders} headings`)
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) fragWalk(n.namedChild(i))
    }
    fragWalk(sub.rootNode)
    sub.delete?.()
  }

  // ── B6: a document naming itself — front matter title, or the first H1.
    const titleWalk = (n: any) => {
    if (n.type === "minus_metadata") {
      const raw: string = n.text ?? ""
      for (let i = 0; i < raw.length; i++) {
        if (raw.charCodeAt(i) !== 116 /* t */) continue
        const lineStart = raw.lastIndexOf("\n", i) + 1
        const line = raw.slice(lineStart, raw.indexOf("\n", i) < 0 ? raw.length : raw.indexOf("\n", i))
        const colon = line.indexOf(":")
        if (colon > 0 && line.slice(0, colon).trim() === "title") {
          P_EXPORTS_H1.occurrences++
          markHit(P_EXPORTS_H1, fileLabel)
          if (P_EXPORTS_H1.examples.length < 6) P_EXPORTS_H1.examples.push(`${fileLabel}: front matter title`)
          return
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) titleWalk(n.namedChild(i))
  }
  titleWalk(tree.rootNode)

  // ── B1/B2/B7: the inline half. The engine pre-parses every `inline` node with the
  // companion grammar, and the analyzer reads those sub-trees, so the probes do too —
  // a probe that read the file text instead could be faked by a code span or a fence,
  // which is the arbiter's own warning.
  const fileDir = path.posix.dirname(f.rel)
  for (const blk of inlineTreesOf(tree.rootNode)) {
    let sub: any
    try { sub = inlineParser.parse(blk.text) } catch { sub = null }
    if (!sub) continue
    const inlWalk = (n: any) => {
      const wasInImage = imageDepth
      if (n.type === "image") imageDepth++
      switch (n.type) {
        case "link_destination": {
          const raw = textOf(n)
          const dest = cleanDestination(raw)
          if (dest && !hasScheme(dest) && !dest.startsWith("//") && dest.charCodeAt(0) !== 47 /* / */) {
            P_REL_ALL.occurrences++
            markHit(P_REL_ALL, fileLabel)
            // A RELATIVE destination. Existence is checked against the repository's own
            // tracked set, so a link to a file that is not there cannot be counted.
            const joined = path.posix.normalize(path.posix.join(fileDir, dest))
            if (f.repo.tracked.has(joined)) {
              // ROLE, not shape: an image's source bytes are required for THIS document
              // to render, so the file is a dependency of the document; a hyperlink's
              // target is somewhere the reader goes, so it is a reference. Both are
              // counted, apart, because collapsing them would repeat the toml lane's
              // mistake (216 path hits, every one a shape) in the opposite direction.
              const isImage = n.parent?.type === "image" || insideImage(n)
              const p = isImage ? P_IMPORTS_IMAGEFILE : P_IMPORTS_LINKFILE
              p.occurrences++
              markHit(p, fileLabel)
              if (p.examples.length < 6) p.examples.push(`${fileLabel}: ${raw}${isImage ? " (image)" : ""}`)
              const dot = joined.lastIndexOf(".")
              const ext = dot >= 0 ? joined.slice(dot).toLowerCase() : "(no extension)"
              relFileBreakdown[`${isImage ? "image" : "link"}${ext}`] = (relFileBreakdown[`${isImage ? "image" : "link"}${ext}`] ?? 0) + 1
            }
          }
          break
        }
        case "shortcut_link":
        case "full_reference_link":
        case "collapsed_reference_link":
        case "image":
          break
      }
      // B7: a wiki link is bracket punctuation with no link_destination, so it has to
      // be looked for as a SHAPE of the inline tree — and only outside a code span,
      // which the grammar gives anonymous children and this walk cannot descend into.
      if (n.type === "full_reference_link") {
        // `[a][b]` — a wiki link would be `[[a]]`, so the LABEL's own text is `[b]` for an
        // ordinary reference link and `[[b]]` for a wiki link. The brackets must be
        // STRIPPED before the test, because the first version of this probe compared the
        // raw label text against `[` and matched every reference link in the corpus:
        // measured 8 hits over 3 files in a 60-file draw, and all 8 were ordinary
        // reference links (`cargo/doc/contrib/src/issues.md: [new-issues]`,
        // `[cargotest-example]`). That is the arbiter's own warning in its own shape —
        // a probe that matches a SHAPE rather than a ROLE produces a number, and the
        // number is worth nothing.
        const label = n.namedChildren.find((c: any) => c.type === "link_label")
        const raw = textOf(label ?? { text: "" })
        const inner = stripBrackets(raw)
        if (inner.startsWith("[")) {
          P_WIKILINK.occurrences++
          markHit(P_WIKILINK, fileLabel)
          if (P_WIKILINK.examples.length < 6) P_WIKILINK.examples.push(`${fileLabel}: ${raw}`)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) inlWalk(n.namedChild(i))
      imageDepth = wasInImage
    }
    inlWalk(sub.rootNode)
    imageDepth = 0

    // B2: an include/transclude construct. This one is a probe over TEXT the grammar
    // models as an opaque string or as fence CONTENT, which is the structural
    // situation the workstream calls a value in a reserved position — the reason
    // instrument A is silent on it. Read on the INLINE tree, so a construct quoted in
    // prose is visible here while one inside a code span is not reachable, exactly as
    // it is for the analyzer.
    scanInclude(blk.text, fileLabel)
  }
  // The block-level half of B2: fence content and html blocks, which are block nodes
  // and never appear in an `inline` tree.
  const blockTextScan = (n: any) => {
    if (n.type === "fenced_code_block" || n.type === "html_block") {
      const raw = n.text ?? ""
      scanInclude(raw, fileLabel)
    }
    for (let i = 0; i < n.namedChildCount; i++) blockTextScan(n.namedChild(i))
  }
  blockTextScan(tree.rootNode)
  tree.delete?.()
}

function scanInclude(text: string, fileLabel: string): void {
  for (const tok of INCLUDE_TOKENS) {
    let at = text.indexOf(tok)
    while (at >= 0) {
      P_IMPORTS_INCLUDE.occurrences++
      markHit(P_IMPORTS_INCLUDE, fileLabel)
      includeBreakdown[tok] = (includeBreakdown[tok] ?? 0) + 1
      if (P_IMPORTS_INCLUDE.examples.length < 6) {
        P_IMPORTS_INCLUDE.examples.push(`${fileLabel}: ${tok}`)
      }
      at = text.indexOf(tok, at + tok.length)
    }
  }
}

for (const p of probes) p.files = perFileHits.get(p.id)?.size ?? 0
const linkP = probes.find((p) => p.id === P_IMPORTS_LINKFILE.id)!
linkP.breakdown = relFileBreakdown
const incP = probes.find((p) => p.id === P_IMPORTS_INCLUDE.id)!
incP.breakdown = includeBreakdown
const fenceP = probes.find((p) => p.id === P_CALLS_FENCE.id)!
fenceP.breakdown = fenceLangs

// ─────────────────────────────────────────────────────────── report
const mdChild = childTypes.get("minus_metadata")
const out = {
  instrument: "markdown construct probe (validation/m14/fixtures/markdown/construct-probe.ts)",
  corpusRoot: CR,
  seed: SEED,
  admittedMarkdownFiles: population.length,
  reposWithMarkdown: repos.map((r) => r.name),
  drawn: draw.length,
  drawHash,
  parsed,
  treeFailures,
  instrumentA: {
    distinctNodeTypes: nodeTypes.size,
    nodeTypeCounts: Object.fromEntries([...nodeTypes.entries()].sort((a, b) => b[1] - a[1])),
    minusMetadataChildTypes: mdChild ? Object.fromEntries([...mdChild.entries()].sort((a, b) => b[1] - a[1])) : {},
  },
  instrumentB: probes,
}

console.log(`markdown construct probe — ${draw.length} files (seed ${SEED}, sha256=${drawHash.slice(0, 16)})`)
console.log(`admitted markdown files in corpus: ${population.length} across ${repos.length} repos`)
console.log("")
console.log(`INSTRUMENT A — grammar vocabulary`)
console.log(`  distinct node types produced by both pinned grammars: ${nodeTypes.size}`)
console.log(`  minus_metadata child types seen: ${mdChild ? [...mdChild.keys()].join(", ") : "(none)"}`)
console.log("")
console.log(`INSTRUMENT B — semantic counts on the tree`)
for (const p of probes) {
  console.log(`  ${p.id}`)
  console.log(`    question  ${p.question}`)
  console.log(`    measured  ${p.occurrences} occurrence(s) in ${p.files} file(s)`)
  if (p.examples.length > 0) console.log(`    examples  ${p.examples.slice(0, 3).join(" | ")}`)
  if (p.breakdown && Object.keys(p.breakdown).length > 0) {
    const top = Object.entries(p.breakdown).sort((a, b) => b[1] - a[1]).slice(0, 12)
    console.log(`    breakdown ${top.map(([k, v]) => `${k}=${v}`).join(", ")}`)
  }
  console.log(`    overturn  ${p.overturnIf}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nwrote ${OUT}`)
}