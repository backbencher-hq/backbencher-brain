/**
 * MARKDOWN PASS-2 LABELLING PROBE — the four questions a census cannot answer for itself.
 *
 * ## Why this exists
 *
 * The M60 pass-2 brief asks, for every EMITTED type, to "write the strongest argument
 * that the label is WRONG and see whether the corpus supports it", and to answer the
 * six questions adversarially. Three things were not answerable from the artefacts the
 * lane already had, and each is a measurement rather than an argument:
 *
 * 1. **The inline grammar was never inventoried.** `construct-probe.ts` loads BOTH
 *    pinned wasms and its header says instrument A enumerates "every node type BOTH
 *    pinned grammars actually produce", but its instrument A walks the BLOCK tree only
 *    and the 47 node types it recorded are all block types — `inline_link`,
 *    `uri_autolink`, `code_span` and the rest of the companion grammar's 282 named types
 *    are absent. An instrument-A ruling that omits half the grammars is not the
 *    instrument the gate's header describes, and this file records the union so the
 *    ruling table's `nodeTypesThatWouldMeanIt` lists can be checked against a list that
 *    is actually complete. The header is corrected here rather than defended.
 *
 * 2. **Resolution was reported per TYPE, not per ROLE.** The census reports `uses`
 *    resolving at both ends on 390 of 3,724 edges and stops. That number is dominated
 *    by external URLs, which cannot resolve to a symbol in any file, so it says
 *    almost nothing about whether a LINK edge is well-formed. The `uses` edges of this
 *    lane carry a `role`, so resolution per role is the question that has an answer.
 *
 * 3. **The DESTINATION SPELLING was never classified.** Every link destination is
 *    published as a `uses` edge under one label, whether it is `https://example.com`,
 *    `./other.md`, `#anchor` or `<user@host>`. Those four are different relations and
 *    the lane asserts they are the same one. This probe counts each class ON THE TREE
 *    and, for the relative class, resolves it against the repository's own tracked set,
 *    because "the strongest argument the label is wrong" is only worth anything if the
 *    corpus can say how big each class is.
 *
 * The one text-shaped thing measured here is stated: classifying a destination as
 * "has a URL scheme" is a character-code scan of a node's own text, the same shape as
 * the analyzer's existing `stripAngleBrackets`. It is applied ONLY to nodes the grammar
 * named (`link_destination`, `uri_autolink`, `email_autolink`), never to raw file text,
 * so a fenced code block or a string cannot produce a hit.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/pass2-labelling-probe.ts \
 *     [--sample N] [--seed s] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SAMPLE = Number(arg("sample", "1200"))
const SEED = arg("seed", "markdown-pass2-labelling-v1")
const OUT = arg("out", "")

// ─────────────────────────────────────────────────────────── grammars (BOTH)
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const loadWasm = async (rel: string) => await WSL.load(readFileSync(path.join(ROOT, "wasm", rel)))
const blockParser = new WSP()
blockParser.setLanguage(await loadWasm("tree-sitter-markdown.wasm"))
const inlineParser = new WSP()
inlineParser.setLanguage(await loadWasm("tree-sitter-markdown_inline.wasm"))

// ─────────────────────────────────────────────────────────── corpus
type Repo = { name: string; dir: string; tracked: Set<string> }
const repos: Repo[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  repos.push({ name: e, dir, tracked: new Set(tracked) })
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

// ─────────────────────────────────────────────────────────── 1. instrument A, BOTH grammars
const blockTypes = new Map<string, number>()
const inlineTypes = new Map<string, number>()
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

// ─────────────────────────────────────────────────────────── 2. destination classification
/** The four classes a `link_destination` / autolink's own text can be. */
const classify = (raw: string): "fragment" | "absolute-path" | "protocol-relative" | "scheme" | "relative" => {
  const t = raw.trim()
  if (t.charCodeAt(0) === 35 /* '#' */) return "fragment"
  if (t.startsWith("//")) return "protocol-relative"
  if (t.charCodeAt(0) === 47 /* '/' */) return "absolute-path"
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 47 /* / */ || c === 63 /* ? */ || c === 35 /* #' */) break
    if (c === 58 /* :' */) return i > 1 ? "scheme" : "relative"
  }
  return "relative"
}
type ClassRow = { kind: string; occurrences: number; files: number; resolvesToTrackedFile: number; examples: string[] }
const classes = new Map<string, ClassRow>()
const classRow = (kind: string): ClassRow => {
  let r = classes.get(kind)
  if (!r) { r = { kind, occurrences: 0, files: 0, resolvesToTrackedFile: 0, examples: [] }; classes.set(kind, r) }
  return r
}

/** Does `dest`, relative to the file's own directory, name a tracked file of THIS repo? */
const resolves = (f: FileRec, dest: string): boolean => {
  const clean = dest.split("#")[0].split("?")[0]
  if (!clean) return false
  const base = path.posix.dirname(f.rel)
  const joined = path.posix.normalize(path.posix.join(base, clean))
  if (joined.startsWith("..")) return false
  return f.repo.tracked.has(joined)
}

const classFiles = new Map<string, Set<string>>()
const noteClass = (kind: string, f: FileRec, dest: string, isImage: boolean) => {
  const row = classRow(kind)
  row.occurrences++
  if (isImage) row.kind = row.kind // kind carries the class; image-ness is counted below
  if (resolves(f, dest)) row.resolvesToTrackedFile++
  let s = classFiles.get(kind)
  if (!s) { s = new Set(); classFiles.set(kind, s) }
  s.add(key(f))
  if (row.examples.length < 5) row.examples.push(`${key(f)}: ${dest.slice(0, 70)}`)
}
const imageByClass = new Map<string, number>()
const bumpImage = (kind: string) => imageByClass.set(kind, (imageByClass.get(kind) ?? 0) + 1)

// ─────────────────────────────────────────────────────────── 3. html_block delegation population
let htmlBlocks = 0
let htmlFiles = 0
let htmlWithScript = 0
let htmlWithScriptSrc = 0
let htmlWithStyleLink = 0
let htmlWithImg = 0
const htmlExamples: string[] = []
// A `<script>`/`<style>`/`<link>`/`<img>` tag inside an html_block, found by a
// character-code scan of THAT NODE'S text. The node is named by the grammar, so a
// fenced code block or a paragraph cannot produce a hit — which is the whole reason
// this is a tree probe and not a regex over the file.
const tagScan = (text: string): { script: number; scriptSrc: number; styleLink: number; img: number } => {
  let script = 0, scriptSrc = 0, styleLink = 0, img = 0
  const lt = "<"
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== lt.charCodeAt(0)) continue
    if (text.startsWith("<script", i)) { script++; if (text.startsWith(" src", i + 7)) scriptSrc++ }
    else if (text.startsWith("<style", i)) styleLink++
    else if (text.startsWith("<link", i)) styleLink++
    else if (text.startsWith("<img", i)) img++
  }
  return { script, scriptSrc, styleLink, img }
}

// ─────────────────────────────────────────────────────────── 4. multi-line setext heading attribution
let setextHeadings = 0
let setextWithInline = 0
let setextInlineSpansLines = 0
let setextInlineLinesAfterFirst = 0
const setextExamples: string[] = []

// ─────────────────────────────────────────────────────────── 5. headingCount metadata
const headingCountValues = new Map<number, number>()

// ─────────────────────────────────────────────────────────── per-file walk
type InlineBlock = { node: any; start: number; line: number }
const collectInlineBlocks = (root: any): InlineBlock[] => {
  const out: InlineBlock[] = []
  const s: any[] = [root]
  while (s.length > 0) {
    const n = s.pop()!
    if (n.type === "inline") { out.push({ node: n, start: n.startIndex, line: n.startPosition.row + 1 }); continue }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) s.push(c) }
  }
  return out.sort((a, b) => a.start - b.start)
}

let parsed = 0
let parseFailures = 0
const parseFailureExamples: string[] = []
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    let r: any
    try { r = await parseFile(f.abs, f.repo.dir) } catch { parseFailures++; if (parseFailureExamples.length < 5) parseFailureExamples.push(key(f)); continue }
    parsed++
    const hc = Number(r?.metadata?.headingCount ?? -1)
    headingCountValues.set(hc, (headingCountValues.get(hc) ?? 0) + 1)

    let tree: any = null
    try { tree = blockParser.parse(f.text) } catch { tree = null }
    if (tree) {
      const root = tree.rootNode
      // instrument A, both grammars, separately so the union is auditable
      const v = (n: any) => { bump(blockTypes, n.type); for (let c = 0; c < n.childCount; c++) v(n.child(c)) }
      v(root)
      // html_block population
      const w = (n: any) => {
        if (n.type === "html_block") {
          htmlBlocks++
          const s = tagScan(n.text)
          if (s.script) htmlWithScript++
          htmlWithScriptSrc += s.scriptSrc
          htmlWithStyleLink += s.styleLink
          htmlWithImg += s.img
          if ((s.script || s.styleLink || s.img) && htmlExamples.length < 8) {
            htmlExamples.push(`${key(f)}:${n.startPosition.row + 1}: script=${s.script} scriptSrc=${s.scriptSrc} styleLink=${s.styleLink} img=${s.img}`)
          }
        }
        if (n.type === "setext_heading") {
          setextHeadings++
          const inline = (() => {
            for (let c = 0; c < n.namedChildCount; c++) {
              const ch = n.namedChild(c)
              if (!ch) continue
              if (ch.type === "inline") return ch
              if (ch.type === "paragraph") {
                for (let d = 0; d < ch.namedChildCount; d++) { const g = ch.namedChild(d); if (g && g.type === "inline") return g }
              }
            }
            return null
          })()
          if (inline) {
            setextWithInline++
            const rows = inline.endPosition.row - inline.startPosition.row
            if (rows > 0) {
              setextInlineSpansLines++
              setextInlineLinesAfterFirst += rows
              if (setextExamples.length < 8) setextExamples.push(`${key(f)}:${inline.startPosition.row + 1}: spans ${rows + 1} lines: ${JSON.stringify(inline.text.slice(0, 90))}`)
            }
          }
        }
        for (let c = 0; c < n.childCount; c++) w(n.child(c))
      }
      w(root)
      // instrument A of the INLINE grammar, over every inline block in the file
      for (const blk of collectInlineBlocks(root)) {
        let sub: any = null
        try { sub = inlineParser.parse(blk.node.text) } catch { sub = null }
        if (!sub) continue
        const iv = (n: any) => { bump(inlineTypes, n.type); for (let c = 0; c < n.childCount; c++) iv(n.child(c)) }
        iv(sub.rootNode)
        // destination classes, from NAMED nodes only
        const dv = (n: any, insideImage: boolean) => {
          if (n.type === "link_destination") {
            const dest = n.text.trim()
            if (dest) {
              const kind = classify(dest)
              noteClass(kind, f, dest, insideImage)
              if (insideImage) bumpImage(kind)
            }
          }
          const img = insideImage || n.type === "image"
          for (let c = 0; c < n.namedChildCount; c++) { const ch = n.namedChild(c); if (ch) dv(ch, img) }
        }
        dv(sub.rootNode, false)
        sub.delete?.()
      }
      tree.delete?.()
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ─────────────────────────────────────────────────────────── resolution per ROLE, from parseFile
type RoleRow = { edges: number; sourceResolved: number; targetResolved: number; bothEnds: number; lineNumbered: number; confidence: Record<string, number>; evidenceClass: Record<string, number> }
const roles = new Map<string, RoleRow>()
const roleRow = (k: string): RoleRow => {
  let r = roles.get(k)
  if (!r) { r = { edges: 0, sourceResolved: 0, targetResolved: 0, bothEnds: 0, lineNumbered: 0, confidence: {}, evidenceClass: {} }; roles.set(k, r) }
  return r
}
let relTotal = 0
let symTotal = 0
idx = 0
async function worker2() {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    let r: any
    try { r = await parseFile(f.abs, f.repo.dir) } catch { continue }
    const names = new Set<string>((r?.symbols ?? []).map((s: any) => String(s.name)))
    symTotal += names.size
    for (const x of r?.relationships ?? []) {
      const role = String((x.metadata ?? {}).role ?? "(none)")
      const rr = roleRow(role)
      const src = names.has(String(x.source))
      const tgt = names.has(String(x.target))
      rr.edges++
      relTotal++
      if (src) rr.sourceResolved++
      if (tgt) rr.targetResolved++
      if (src && tgt) rr.bothEnds++
      if (Number(x.line_number ?? 0) > 0) rr.lineNumbered++
      const c = String(x.confidence)
      rr.confidence[c] = (rr.confidence[c] ?? 0) + 1
      const e = String((x.metadata ?? {}).evidenceClass ?? "(none)")
      rr.evidenceClass[e] = (rr.evidenceClass[e] ?? 0) + 1
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker2()))

const union = new Set<string>([...blockTypes.keys(), ...inlineTypes.keys()])
const report = {
  instrument: "markdown pass-2 labelling probe (validation/m14/fixtures/markdown/pass2-labelling-probe.ts)",
  entryPoint: "parseFile (src/ast/pool-worker.ts) for the emitted edge census; both pinned wasms for the tree counts",
  corpusRoot: CR,
  seed: SEED,
  admittedMarkdownFiles: population.length,
  reposWithMarkdown: repos.filter((r) => [...r.tracked].some((t) => /\.(md|markdown)$/i.test(t))).length,
  drawn: draw.length,
  drawHash,
  parsed,
  parseFailures,
  parseFailureExamples,
  corrects:
    "construct-probe.ts's instrument A walks the BLOCK tree only while its header claims both grammars; this file records the union",
  instrumentA: {
    note: "blockTypes are whole-file; inlineTypes are the companion grammar over every inline block of every sampled file. The union is what a ruling's nodeTypesThatWouldMeanIt must be checked against.",
    blockDistinct: blockTypes.size,
    inlineDistinct: inlineTypes.size,
    unionDistinct: union.size,
    blockTypeCounts: Object.fromEntries([...blockTypes].sort()),
    inlineTypeCounts: Object.fromEntries([...inlineTypes].sort()),
    union: [...union].sort(),
  },
  destinationClasses: {
    note: "every `link_destination` on the companion inline tree, classified by the node's OWN text. `resolvesToTrackedFile` is the count whose relative path names a file in the repository's own `git ls-files` set.",
    rows: [...classes.values()]
      .map((r) => ({ ...r, files: classFiles.get(r.kind)?.size ?? 0 }))
      .sort((a, b) => b.occurrences - a.occurrences),
    imagesByClass: Object.fromEntries(imageByClass),
  },
  htmlBlockPopulation: {
    note: "the delegation argument for `calls` and `imports`: the block grammar gives an html_block one opaque text child, so any script/style/link/img inside it is invisible to this lane. Counted on the NAMED node, never on file text.",
    htmlBlockNodes: htmlBlocks,
    filesWithHtmlBlock: htmlFiles,
    htmlBlocksCarryingScript: htmlWithScript,
    scriptSrcOccurrences: htmlWithScriptSrc,
    styleOrLinkRelOccurrences: htmlWithStyleLink,
    imgOccurrences: htmlWithImg,
    examples: htmlExamples,
  },
  setextHeadingInlineShape: {
    note: "MD-DEFECT-1's fix reads a setext heading's text from the paragraph's inline node. If that node spans more than one line, every link on a continuation line is attributed to a heading whose PUBLISHED NAME is the first line only (headingText takes raw.slice(0, nl)).",
    setextHeadings: setextHeadings,
    withInline: setextWithInline,
    inlineSpansMoreThanOneLine: setextInlineSpansLines,
    continuationLinesAttributedToFirstLineName: setextInlineLinesAfterFirst,
    examples: setextExamples,
  },
  headingCountMetadata: {
    note: "`metadata.headingCount` is assigned `headingStack.length` at RETURN time, so it is the depth of the LAST heading's ancestor chain, which CommonMark caps at 6 — not a count of headings. The distribution is the measurement.",
    distinctValues: Object.fromEntries([...headingCountValues].sort((a, b) => a[0] - b[0])),
    max: Math.max(...headingCountValues.keys()),
  },
  emittedByRole: {
    note: "the `Resolved` question (six questions #5) per ROLE rather than per TYPE. `bothEnds` counts an edge whose source AND target are both names this file publishes.",
    relationships: relTotal,
    symbolsInDrawnFiles: symTotal,
    rows: [...roles.entries()]
      .sort((a, b) => b[1].edges - a[1].edges)
      .map(([role, r]) => ({
        role,
        edges: r.edges,
        sourceResolved: r.sourceResolved,
        targetResolved: r.targetResolved,
        bothEnds: r.bothEnds,
        bothEndsPct: r.edges > 0 ? `${((r.bothEnds / r.edges) * 100).toFixed(1)}%` : "n/a",
        lineNumbered: r.lineNumbered,
        confidence: r.confidence,
        evidenceClass: r.evidenceClass,
      })),
  },
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`wrote ${OUT}`)
}
console.log(JSON.stringify({
  drawn: draw.length,
  parsed,
  parseFailures,
  instrumentA: { block: report.instrumentA.blockDistinct, inline: report.instrumentA.inlineDistinct, union: report.instrumentA.unionDistinct },
  destinationClasses: report.destinationClasses.rows.map((r) => ({ kind: r.kind, n: r.occurrences, files: r.files, resolves: r.resolvesToTrackedFile })),
  imagesByClass: report.destinationClasses.imagesByClass,
  htmlBlockPopulation: { htmlBlockNodes: htmlBlocks, script: htmlWithScript, scriptSrc: htmlWithScriptSrc, styleLink: htmlWithStyleLink, img: htmlWithImg },
  setext: report.setextHeadingInlineShape,
  headingCountMax: report.headingCountMetadata.max,
  emittedByRole: report.emittedByRole.rows.map((r) => ({ role: r.role, edges: r.edges, bothEnds: r.bothEnds, pct: r.bothEndsPct, ev: r.evidenceClass })),
}, null, 2))