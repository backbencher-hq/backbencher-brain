import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "../..")

/** Mirrors differential.ts's local `TreeEdge`. Duplicated rather than imported so
 *  this file depends on nothing from the 18,000-line harness it feeds. */
interface TreeEdge { label: string; from: string; target: string }

// ============================================================================
// M14 #290 — the MARKDOWN truth oracle.
//
// WHY THIS LANE NEEDED ONE, and it is not the usual reason. Every other lane in
// this file that joined the differential had a *fabricating* analyzer or an
// *unverifiable* one. markdown had neither: it emitted a M12 differential
// reading precision 1.000 / recall 1.000, a contract probe at 31/31, and a
// corpus claim of 734 clean files with 0 crashes. That is the WORST case to hand
// to the differential, because the M12 number is a mirror — `truthSource:
// "manual_audit"`, no commit recorded, and `verify-differential-freshness.ts`
// files it under `UNPINNED (no inputs block — cannot be checked, NOT covered)`.
// A truth file hand-authored by the same hand as the analyzer, over three
// hand-written files totalling 99 lines, cannot disagree with it. That is
// verbatim the M14 #277 bash finding: "A lane whose truth cannot disagree with
// its analyzer has no differential; it has a mirror."
//
// The measurement that made the gap concrete: the 99-line fixture corpus
// contains zero reference-style links, zero footnotes, zero duplicate headings
// and zero duplicate code blocks — and those are precisely the four constructs
// where the lane was wrong. Every real defect was a fixture-absence defect, and
// no instrument could see them because the truth was made of the same
// assumptions as the analyzer.
//
// WRITTEN FROM CommonMark, NOT FROM THE ANALYZER. This is the F9 collusion
// doctrine (the oracle that shares the analyzer's data cannot see a
// fabrication, so a lane can agree with a WRONG contract and still report
// 100/0/0). Nothing here is imported from real-markdown-analyzer.ts, and no
// table of node types, marker names or language names is shared. What IS
// deliberately reimplemented rather than shared is the *ordinal* rule for
// repeated sites, and that is the #917/#919 line: a SHAPE rule with one correct
// answer is written twice, a TABLE is written once and diffed. Two sites need
// two identities — that is a shape with one right answer — and an oracle that
// collapsed them would report 1,920 MISSING rows against a per-site analyzer
// and be read as "the analyzer emits almost nothing", which is the scss trap
// this file already records at length.
//
// THE CONSTRUCTS, from CommonMark's own section list:
//
//   §4 ATX headings / §4.3 setext headings
//      A heading is a SECTION. Nesting is by LEVEL: a heading of level N is
//      contained in the nearest preceding heading of lower level. Setext level
//      comes from the underline run (1 x `=`, 2 x `-`).
//   §4.6 thematic breaks, §4.5 code blocks
//      A fenced code block is a SITE. It has no containment of its own beyond
//      the section it sits in.
//   §4.10 pipe tables (GFM)
//      A table's identity is its header cells; each header cell is contained by
//      the table.
//   §7 links and images
//      A link destination is a `uses` edge from the enclosing section. Inline
//      and reference forms are the SAME edge: what differs is where the
//      destination text is written, not whether there is a link.
//   §7.1 link reference definitions
//      A reference link is a link ONLY if a definition for its label exists in
//      the document. CommonMark: "If a link reference definition has not been
//      defined for the link label, then it is not a link" — the construct
//      renders as literal text. So the oracle resolves a label through the
//      document's own definitions and emits nothing for an undefined one. This
//      is the rule that, measured on the lane's corpus, suppresses 171 edges
//      dominated by bare bracketed citation markers.
//   §6 code spans
//      A code span's content is LITERAL TEXT. The inline grammar gives a
//      `code_span` only anonymous children, so a `link_destination` is
//      structurally unreachable beneath one and this oracle needs no filter to
//      exclude it — the same structural guarantee the analyzer has.
//
// NOT MODELLED, and each omission is a declared boundary rather than a gap:
// footnotes (no `footnote_reference` node type exists in either pinned grammar —
// measured), wiki links (not a CommonMark construct), front-matter keys (the
// block grammar models `minus_metadata` as one node with no key/value
// children).
// ============================================================================

let MARKDOWN_INLINE_PARSER: any = null

/**
 * The lane's own inline parser, loaded independently of the engine's.
 *
 * It must be a SEPARATE parser instance from the one the analyzer gets inside
 * `ASTEngine.parseFile`, or the oracle would be reading the analyzer's own
 * pre-parse and the two sides would agree by construction. The block tree
 * arrives as `root`; this supplies the half the block grammar cannot see.
 */
export async function markdownInlineParser(): Promise<any> {
  if (MARKDOWN_INLINE_PARSER) return MARKDOWN_INLINE_PARSER
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const Lang = wts.Language ?? wts.default?.Language
  if (!P.initDone) {
    await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  }
  const grammar = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-markdown_inline.wasm")))
  const p = new P()
  p.setLanguage(grammar)
  MARKDOWN_INLINE_PARSER = p
  return p
}

/** `[^x]` / `[x]` label text, brackets stripped by position. */
function mdLabelText(text: string): string {
  const t = text.trim()
  if (t.length >= 2 && t.charCodeAt(0) === 91 && t.charCodeAt(t.length - 1) === 93) return t.slice(1, -1).trim()
  return t
}

/** `<...>` autolink body, brackets stripped by position. */
function mdAutolinkText(text: string): string {
  const t = text.trim()
  if (t.length >= 2 && t.charCodeAt(0) === 60 && t.charCodeAt(t.length - 1) === 62) return t.slice(1, -1)
  return t
}

/** A heading's level, from the marker's own name. 0 when there is no marker. */
function mdHeadingLevel(node: any): number {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    const t = c.type
    if (t.startsWith("atx_h") && t.endsWith("_marker")) {
      // `atx_h<N>_marker`: the digit is at index 5, not 4 — index 4 is the `h`.
      // The first version read slice(4, 5), got "h", and `Number("h")` is NaN, so
      // EVERY ATX heading scored 0 and the oracle silently attributed every code
      // block and table to `document`. It presented as a 48-row MISSING / 19.6%
      // unexplained disagreement rather than as an exception, which is the worst
      // shape a parser bug can take: the harness reported it as a CONTRACT dispute.
      const n = Number(t.charCodeAt(5) ? t.slice(5, 6) : "")
      if (n >= 1 && n <= 6) return n
    }
    if (t === "setext_h1_underline") return 1
    if (t === "setext_h2_underline") return 2
  }
  return 0
}

/**
 * A heading's display text, derived here from the block grammar alone.
 *
 * Written from CommonMark §4.3 ("The optional closing sequence of #s must be
 * preceded by spaces or tabs and may be followed by spaces or tabs only") and
 * §4.2 (a setext heading's content is a single line, underlined) rather than
 * copied from the analyzer — if the two agreed by construction the lane could
 * not see a disagreement about either rule, which is the whole point of an
 * oracle.
 */
function mdHeadingText(node: any): string {
  let inline: any = null
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "inline") { inline = c; break }
  }
  if (inline) {
    let text = inline.text.trim()
    // strip an ATX closing run, by character code and by the space/tab rule
    if (text.length > 0 && text.charCodeAt(text.length - 1) === 35 /* # */) {
      let end = text.length
      while (end > 0 && text.charCodeAt(end - 1) === 35) end--
      if (end < text.length) {
        const before = end > 0 ? text.charCodeAt(end - 1) : 0
        if (before === 32 || before === 9) text = text.slice(0, end).trim()
      }
    }
    return text
  }
  // An ATX heading with NO inline child has no text, and its node text IS its
  // marker. CommonMark: a heading's content is what follows the marker, and an
  // ATX heading cannot be underlined, so the setext rule does not apply to it.
  //
  // F9-PROBE-MD9 caught this as COLLUSION: the analyzer published nothing for a
  // document of empty headings (correctly) while this oracle derived `##` and
  // `###` as section names, so the two sides had agreed on nothing and the lane
  // could not see the difference. The construct is rare enough that neither
  // corpus contains it — which is the argument for having a probe battery at all
  // rather than trusting the differential alone.
  if (node.type === "atx_heading") return ""
  // Setext: the text is the paragraph's first line; the underline is the last.
  const raw = node.text.trim()
  if (!raw) return ""
  const nl = raw.indexOf("\n")
  return (nl >= 0 ? raw.slice(0, nl) : raw).trim()
}

/** A pipe table's identity: its header cells joined by `/` (GFM §4.10). */
function mdTableName(node: any): string {
  const cells: string[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "pipe_table_header") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const cell = c.namedChild(k)
        if (cell && cell.type === "pipe_table_cell") {
          const t = cell.text.trim()
          if (t) cells.push(t)
        }
      }
      break
    }
  }
  return cells.length > 0 ? cells.join("/") : "table"
}

/** A fenced code block's identity: `code_block` or `code_block.<lang>`. */
function mdCodeBlockName(node: any): string {
  let info: any = null
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "info_string") { info = c; break }
  }
  if (!info) return "code_block"
  let lang = ""
  for (let i = 0; i < info.namedChildCount; i++) {
    const c = info.namedChild(i)
    if (c && c.type === "language") { lang = c.text.trim(); break }
  }
  if (!lang) lang = info.text.trim()
  return lang === "" || lang === "text" ? "code_block" : `code_block.${lang}`
}

/**
 * Every `inline` node in the block tree, in source order, with the tree the
 * INLINE grammar gives for its text.
 *
 * Independent of `ASTEngine.extractMarkdownInlineBlocks`, which the analyzer's
 * path uses: the oracle re-derives the block list from the tree it was handed
 * rather than importing the engine's own reader, for the same reason it does not
 * import the analyzer.
 */
async function mdInlineTrees(root: any, content: string): Promise<{ start: number; tree: any }[]> {
  const blocks: { start: number; end: number }[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "inline") blocks.push({ start: n.startIndex, end: n.endIndex })
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  blocks.sort((a, b) => a.start - b.start)
  const out: { start: number; tree: any }[] = []
  if (blocks.length === 0) return out
  const parser = await markdownInlineParser()
  for (const b of blocks) {
    const text = content.substring(b.start, b.end)
    if (text.trim().length === 0) continue
    try {
      out.push({ start: b.start, tree: parser.parse(text).rootNode })
    } catch {
      /* an inline block the grammar refuses contributes no truth, same as the analyzer */
    }
  }
  return out
}

/**
 * The markdown truth: `contains` for document structure and `uses` for every
 * link destination, derived from the block tree plus the companion inline
 * grammar's own sub-parse.
 *
 * `from` is carried for triage only — the harness's match is site-agnostic
 * (label + normalised target), because the comparator deliberately never reads
 * the source. `unique` keeps one edge per (label, target) per file, which is
 * the truth-side semantics the analyzer side is collapsed to match.
 */
export async function deriveMarkdownEdges(root: any, content: string): Promise<TreeEdge[]> {
  const edges: TreeEdge[] = []
  const unique = new Set<string>()
  const add = (label: string, from: string, target: string) => {
    if (!target) return
    const k = `${label}|${target}`
    if (unique.has(k)) return
    unique.add(k)
    edges.push({ label, from, target })
  }

  // --- §7.1: the document's own link reference definitions, collected first
  // because a reference may be used before its definition is written. First
  // definition of a label wins (CommonMark).
  const definitions = new Map<string, string>()
  {
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()
      if (n.type === "inline") continue
      if (n.type === "link_reference_definition") {
        let label = ""
        let dest = ""
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "link_label") label = mdLabelText(c.text)
          else if (c.type === "link_destination") dest = c.text.trim()
        }
        if (label && dest && !definitions.has(label)) definitions.set(label, dest)
        continue
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  // --- §7: the inline half. Every link destination the document actually
  // contains, resolved through the definitions above.
  const inlineByStart = new Map<number, any>()
  for (const it of await mdInlineTrees(root, content)) inlineByStart.set(it.start, it.tree)

  // --- document structure, in source order.
  //
  // A frame carries BOTH spellings, and conflating them is a bug this oracle shipped
  // into and the differential caught on its first run against a CHANGELOG:
  //
  //   `name` is the CONTRACT spelling (the heading text), which is what a `contains`
  //     edge's TARGET is written as.
  //   `id`   is IDENTITY (the owner-qualified path), which is what a CHILD's base
  //     path is built from.
  //
  // The first version kept only `name`, so `## Dependencies` under `## v1.22.17` and
  // the same heading under `## v1.22.16` both became the frame `Dependencies`, and
  // their `### Added` children then shared one base path `Dependencies.Added` — so
  // the oracle ordinaled them (`Added`, `Added#2`, ... `Added#25`) and reported 175
  // MISSING rows against a correct analyzer. It is the mirror image of the defect the
  // ANALYZER had (which keyed everything by the bare `owner + name` and erased 1,920
  // code blocks): two implementations of the same contract can be wrong in opposite
  // directions, and only a differential that derives both independently finds the
  // pair. A shared helper would have made them agree and told us nothing.
  type Frame = { name: string; id: string; level: number }
  const stack2: Frame[] = []
  // Same-document references: an anchor per heading, and the fragments waiting to be
  // resolved against them. Derived here from the TREE, independently of the
  // analyzer's own slug function — a shared helper would make the two agree by
  // construction, which is the mistake this file's own header records at length.
  const anchors = new Map<string, string>()
  const anchorOcc = new Map<string, number>()
  const pendingAnchors: { section: string; fragment: string }[] = []
  let currentSection = "document"
  let currentSectionId = "document"
  // Repeated sites are ordinaled so a per-site truth can be compared with a
  // per-site analyzer. Keyed by the owner-qualified base, exactly as a site is.
  const seen = new Map<string, number>()
  const siteIdentity = (qualifiedBase: string, bare: string): { id: string; name: string } => {
    const n = (seen.get(qualifiedBase) ?? 0) + 1
    seen.set(qualifiedBase, n)
    return n === 1 ? { id: qualifiedBase, name: bare } : { id: `${qualifiedBase}#${n}`, name: `${bare}#${n}` }
  }

  const walk: any[] = [root]
  while (walk.length > 0) {
    const node = walk.pop()

    if (node.type === "atx_heading" || node.type === "setext_heading") {
      const level = mdHeadingLevel(node)
      const text = mdHeadingText(node)
      if (level > 0 && text) {
        while (stack2.length > 0 && stack2[stack2.length - 1].level >= level) stack2.pop()
        const parent = stack2.length > 0 ? stack2[stack2.length - 1] : null
        const qualifiedBase = parent ? `${parent.id}.${text}` : text
        const { id, name } = siteIdentity(qualifiedBase, text)
        if (parent) add("contains", parent.name, name)
        // Register the anchor under the ORACLE's spelling for this heading, so a
        // fragment resolves to the same name the analyzer publishes. The ordinal is
        // per anchor, because two headings under different parents can share one.
        const slug = mdAnchorSlug(text)
        if (slug) {
          const seen = (anchorOcc.get(slug) ?? 0) + 1
          anchorOcc.set(slug, seen)
          const key = seen === 1 ? slug : `${slug}-${seen - 1}`
          if (!anchors.has(key)) anchors.set(key, name)
        }
        stack2.push({ name, id, level })
        currentSection = name
        currentSectionId = id
      }
      // A heading's OWN inline content is links too.
      const inline = (() => {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.type === "inline") return c
        }
        return null
      })()
      if (inline && text) {
        const t = inlineByStart.get(inline.startIndex)
        if (t) mdCollectLinks(t, currentSection, definitions, add, pendingAnchors)
      }
      continue
    }

    if (node.type === "inline") {
      const t = inlineByStart.get(node.startIndex)
      if (t) mdCollectLinks(t, currentSection, definitions, add, pendingAnchors)
      continue
    }

    if (node.type === "pipe_table") {
      const bare = mdTableName(node)
      const qualifiedBase = currentSectionId === "document" ? bare : `${currentSectionId}.${bare}`
      const { name } = siteIdentity(qualifiedBase, bare)
      add("contains", currentSection, name)
      // GFM §4.10: each header cell is contained by the table.
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "pipe_table_header") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const cell = c.namedChild(k)
            if (cell && cell.type === "pipe_table_cell") {
              const col = cell.text.trim()
              if (col) add("contains", name, col)
            }
          }
          break
        }
      }
      continue
    }

    // `indented_code_block` is the 4-SPACE form of the same construct, and it IS a
    // node in the tree, so truth includes it: a differential that derived fenced blocks
    // and stopped at indented ones was asserting that a document with an indented block
    // and one without it have the same truth, which is false. `mdCodeBlockName` needs no
    // change — an indented block has no `info_string` child, so it already falls through
    // to the bare `code_block`, which is also what the analyzer publishes for it.
    //
    // The population is worth stating, because it is not what a reader assumes. Over
    // 1,138 pinned corpus files the block grammar finds 217 `indented_code_block`
    // nodes, and the large majority of them are NOT authored code: they are the wrapped
    // continuation lines of deeply-nested list items, which CommonMark genuinely reads
    // as indented code (`* a bullet` / `    * a nested bullet` / `        the wrapped
    // text`). The grammar is right and the author did not mean a code block. They are
    // published anyway, because the alternative is the asymmetry MD-G1 names — a
    // reader unable to tell "this document has no code" from "this document has code
    // the lane dropped" — and because a consumer that cares can read `nodeType` and the
    // range. Recorded rather than quietly normalised: a population that is 100x what the
    // gap's original 2-site estimate assumed is a fact about the ESTIMATE, not about the
    // construct.
    if (node.type === "fenced_code_block" || node.type === "indented_code_block") {
      const bare = mdCodeBlockName(node)
      const qualifiedBase = currentSectionId === "document" ? bare : `${currentSectionId}.${bare}`
      const { name } = siteIdentity(qualifiedBase, bare)
      add("contains", currentSection, name)
      continue
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (c) walk.push(c)
    }
  }

  // Same-document references, resolved now that every heading's spelling is known.
  // A fragment that names no heading is NOT a truth row: it is the internal twin of
  // the undefined-reference-link case, and publishing it would assert an endpoint the
  // document does not contain.
  for (const p of pendingAnchors) {
    const hit = anchors.get(mdDecodeFragment(p.fragment))
    if (hit) add("uses", p.section, hit)
  }

  return edges
}

/**
 * Every link destination in one inline tree, as `uses` edges.
 *
 * Descends NAMED children only, which is what makes a code span structurally
 * excluded rather than filtered: the inline grammar gives a `code_span` only
 * anonymous children, so no `link_destination` exists beneath one.
 */
/**
 * A heading's GitHub anchor from its display text, and a link fragment decoded for
 * comparison against one. Both are specified by the RENDERER, not by this repository,
 * which is why they are written out here instead of shared with the analyzer: the
 * specification is external and checkable, so two implementations agreeing is
 * evidence, whereas a shared helper would only be evidence that one function was
 * called twice.
 *
 * Character codes rather than a pattern, to keep the oracle's own zero-regex property
 * — it matters here for a second reason: the oracle exists to disagree with the
 * analyzer, and a pattern is exactly the kind of shared assumption two implementations
 * can be wrong about identically.
 */
function mdAnchorSlug(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const ch = text[i]
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out += ch.toLowerCase()
    else if (c === 32 || c === 9 || c === 45) out += "-"
  }
  return out
}

function mdDecodeFragment(frag: string): string {
  const hex = (c: number): number =>
    c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : -1
  let out = ""
  for (let i = 0; i < frag.length; i++) {
    const c = frag.charCodeAt(i)
    if (c === 37 && i + 2 < frag.length) {
      const hi = hex(frag.charCodeAt(i + 1))
      const lo = hex(frag.charCodeAt(i + 2))
      if (hi >= 0 && lo >= 0) {
        out += String.fromCharCode(hi * 16 + lo)
        i += 2
        continue
      }
    }
    out += frag[i]
  }
  return out.toLowerCase()
}

function mdCollectLinks(
  root: any,
  section: string,
  definitions: Map<string, string>,
  add: (label: string, from: string, target: string) => void,
  pending: { section: string; fragment: string }[],
): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    switch (n.type) {
      case "link_destination": {
        const t = n.text.trim()
        // A destination that is ONLY a fragment names a heading in THIS document, so
        // it is an internal reference. It is deferred because the heading it names may
        // come LATER in the document, and its oracle-side spelling is only known once
        // the heading is reached. Published verbatim it would be a truth row naming a
        // fragment, which the analyzer cannot match by construction.
        if (t && t.charCodeAt(0) === 35) pending.push({ section, fragment: t.slice(1) })
        else if (t) add("uses", section, t)
        break
      }
      case "uri_autolink":
      case "email_autolink": {
        const t = mdAutolinkText(n.text)
        if (t) add("uses", section, t)
        break
      }
      case "full_reference_link":
      case "collapsed_reference_link":
      case "shortcut_link": {
        // The label is a `link_label` for the full form and the link text for
        // the collapsed and shortcut forms. No definition => not a link.
        let label = ""
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "link_label") label = mdLabelText(c.text)
        }
        if (!label) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "link_text") label = c.text.trim()
          }
        }
        if (!label) break
        const dest = definitions.get(label)
        if (dest) add("uses", section, dest)
        break
      }
      case "image": {
        // Reference form: a `link_label` instead of a destination. The inline
        // form's destination is a named child and was already handled above.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "link_label") {
            const label = mdLabelText(c.text)
            if (!label) break
            const dest = definitions.get(label)
            if (dest) add("uses", section, dest)
            break
          }
        }
        break
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}
