/**
 * MARKDOWN EDGE-RECALL PROBE — an instrument that can disagree with the analyzer AND
 * with the lane's own oracle, and that explains every delta it finds.
 *
 * ## Why a third instrument
 *
 * `script/m14/differential.ts` compares the analyzer against
 * `script/m14/markdown-oracle.ts`, and the workstream's own header states that
 * instrument's limit: "the analyzer and the oracle are two separate walkers over one
 * grammar, so they disagree when either is wrong. But when a relationship type is
 * absent from BOTH ... nothing agrees with nothing." A differential cannot see a
 * CONSTRUCT both walkers skip, which is the class of defect the six questions most need
 * tested.
 *
 * This probe closes that hole for the two types the lane emits, by counting something
 * neither the analyzer nor the oracle is asked about: **how many eligible nodes the
 * grammar produced, against how many edges came out.** A skipped construct shows up as a
 * delta between two numbers that were never supposed to be equal by construction, so a
 * silent omission cannot hide inside an agreement.
 *
 * It is deliberately NOT a mirror. It counts NODES on the tree and compares them to the
 * analyzer's EMITTED EDGES for the same files. Where a delta is expected, the probe
 * NAMES the mechanism and counts that mechanism, so an unexplained remainder is visible
 * rather than absorbed into a fudge factor.
 *
 * ## The rows, and what explains each
 *
 *   uses/markdown_link            one edge per non-fragment link_destination, PLUS one
 *                                per reference-link USE (a `full_reference_link` has no
 *                                destination node of its own — the destination lives in a
 *                                block-level `link_reference_definition`), LESS one per
 *                                self-edge the analyzer refuses and per duplicate
 *                                (source,type,target,line) key. All three are counted.
 *   uses/markdown_autolink        uri_autolink + email_autolink
 *   uses/markdown_internal_anchor per-FILE anchor resolution under the renderer's own
 *                                ordinal rule, so a fragment naming a repeated heading's
 *                                `-N` alias counts as resolved
 *   contains/heading_hierarchy     per-LEVEL nesting, MINUS headings the analyzer
 *                                declines to publish (an empty ATX heading has no name,
 *                                MD-D2) and therefore never pushes onto its level stack
 *   code_span/link_destination    a STRUCTURAL reachability claim: 0 expected, and a
 *                                non-zero tree count falsifies it
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/edge-recall-probe.ts \
 *     [--sample N] [--seed s] [--repos a,b] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { ASTEngine } from "../../../../src/ast/engine"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SAMPLE = Number(arg("sample", "200"))
const SEED = arg("seed", "markdown-edge-recall-v1")
const OUT = arg("out", "")
const ONLY = arg("repos", "")
const ONLY_SET = ONLY ? new Set(ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const blockParser = new WSP()
blockParser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-markdown.wasm"))))
const inlineParser = new WSP()
inlineParser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-markdown_inline.wasm"))))

// ─────────────────────────────────────────────────────────── corpus
type FileRec = { repo: string; dir: string; rel: string; abs: string }
const all: FileRec[] = []
for (const e of readdirSync(CR).sort()) {
  if (ONLY_SET && !ONLY_SET.has(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!/\.(md|markdown)$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    all.push({ repo: e, dir, rel, abs })
  }
}
const key = (f: FileRec) => `${f.repo}/${f.rel}`
const draw = SAMPLE > 0 && SAMPLE < all.length
  ? all
      .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
      .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
      .slice(0, SAMPLE)
      .map((x) => x.f)
  : all
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

// ─────────────────────────────────────────────────────────── tree-side counters
const T = {
  linkDestination: 0,
  fragmentOnly: 0,
  uriAutolink: 0,
  emailAutolink: 0,
  codeSpanWithDestination: 0,
  headingsTotal: 0,
  /** Headings nested under a lower-level heading, counting an EMPTY heading as a level. */
  headingsNestedIncludingEmpty: 0,
  /** The same, after removing the levels an EMPTY heading contributes — the analyzer
   *  publishes no symbol for `#` with no content and never pushes it, so the nesting a
   *  reader sees is the one without them. */
  headingsNestedExcludingEmpty: 0,
  emptyHeadings: 0,
  /** Reference-link USES: a `full_reference_link` whose destination comes from a
   *  `link_reference_definition` and therefore carries no `link_destination` node. */
  referenceLinkUses: 0,
  referenceLinkUsesDefined: 0,
  /** `link_destination` nodes that collapse onto an (owner, target, line) triple an
   *  EARLIER node already claimed. `addRel` keys an edge on exactly that triple, so the
   *  second node is a correct de-duplication and the tree count above is one too high by
   *  this much. Named as a mechanism so the residual is not left unexplained. */
  duplicateDestinationNodes: 0,
  duplicateDestinationFiles: new Set<string>(),
  /** Fragments whose anchor the analyzer's own rule resolves IN THIS FILE. */
  fragmentsResolvableInFile: 0,
  fragmentsUnresolvableInFile: 0,
}

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
const stripAtxClosing = (text: string): string => {
  if (text.length === 0 || text.charCodeAt(text.length - 1) !== 35) return text
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 35) end--
  if (end === text.length) return text
  const before = text.charCodeAt(end - 1)
  if (before !== 32 && before !== 9) return text
  return text.slice(0, end).trim()
}
const hexVal = (c: number): number => {
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 97 && c <= 102) return c - 87
  if (c >= 65 && c <= 70) return c - 55
  return -1
}
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
function headingLevelOf(n: any): number {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c.type && c.type.startsWith("atx_h") && c.type.endsWith("_marker")) {
      for (let k = 1; k <= 6; k++) if (c.type.includes(`h${k}`)) return k
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c.type === "setext_h1_underline") return 1
    if (c.type === "setext_h2_underline") return 2
  }
  return 1
}
/** The analyzer's `headingText`, reimplemented rather than imported: a shared helper
 *  guarantees agreement, and agreement with a shared bug is what this workstream
 *  exists to prevent. Returns undefined for an empty heading — MD-D2's absence rule. */
function headingTextOf(n: any): string | undefined {
  if (n.type === "atx_heading") {
    let inline: any = null
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c.type === "inline") { inline = c; break }
    }
    if (!inline) return undefined
    const text = stripAtxClosing(inline.text.trim())
    return text ? text : undefined
  }
  const raw = (n.text ?? "").trim()
  if (!raw) return undefined
  const nl = raw.indexOf("\n")
  const first = (nl >= 0 ? raw.slice(0, nl) : raw).trim()
  return first ? first : undefined
}

const perFile: {
  file: string
  treeLinks: number
  treeFragments: number
  treeUris: number
  treeEmails: number
  codeSpansWithDest: number
  nestedInclEmpty: number
  nestedExclEmpty: number
  emptyHeadings: number
  refUses: number
  refUsesDefined: number
  fragResolvable: number
  fragUnresolvable: number
}[] = []

for (const f of draw) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  const tree = blockParser.parse(text)
  if (!tree) continue
  const rec = {
    file: key(f),
    treeLinks: 0, treeFragments: 0, treeUris: 0, treeEmails: 0, codeSpansWithDest: 0,
    nestedInclEmpty: 0, nestedExclEmpty: 0, emptyHeadings: 0,
    refUses: 0, refUsesDefined: 0, fragResolvable: 0, fragUnresolvable: 0,
  }

  // ── headings: the two nesting counts, and this file's own anchor map under the
  //    renderer's ordinal rule, so an anchor comparison is per FILE rather than pooled.
  const anchorMap = new Map<string, number>()
  const anchorOccurrences = new Map<string, number>()
  /** (heading line -> heading name), sorted, for the owner of an inline block. */
  const headingNamesByLine: [number, string][] = []
  const seenDestinationKeys = new Set<string>()
  const nodeLineOf = (x: any): number => x.startPosition.row + 1
  type H = { level: number; name: string | undefined }
  const withEmpty: H[] = []
  const withoutEmpty: H[] = []
  const headingWalk = (n: any) => {
    if (n.type === "atx_heading" || n.type === "setext_heading") {
      T.headingsTotal++
      const level = headingLevelOf(n)
      const name = headingTextOf(n)
      if (name === undefined) { T.emptyHeadings++; rec.emptyHeadings++ }
      while (withEmpty.length > 0 && withEmpty[withEmpty.length - 1].level >= level) withEmpty.pop()
      while (withoutEmpty.length > 0 && withoutEmpty[withoutEmpty.length - 1].level >= level) withoutEmpty.pop()
      if (withEmpty.length > 0) { T.headingsNestedIncludingEmpty++; rec.nestedInclEmpty++ }
      if (withoutEmpty.length > 0 && name !== undefined) { T.headingsNestedExcludingEmpty++; rec.nestedExclEmpty++ }
      withEmpty.push({ level, name })
      withoutEmpty.push({ level, name })
      if (name) headingNamesByLine.push([nodeLineOf(n), name])
      if (name) {
        const s = slug(name)
        if (s) {
          const seen = (anchorOccurrences.get(s) ?? 0) + 1
          anchorOccurrences.set(s, seen)
          const k = seen === 1 ? s : `${s}-${seen - 1}`
          if (!anchorMap.has(k)) anchorMap.set(k, 1)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) headingWalk(n.namedChild(i))
  }
  headingWalk(tree.rootNode)

  // ── reference-link definitions, so a use can be scored defined/undefined.
  const definitions = new Set<string>()
  const defWalk = (n: any) => {
    if (n.type === "inline") return
    if (n.type === "link_reference_definition") {
      let label: any = null
      let dest: any = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c.type === "link_label" && !label) label = c
        if (c.type === "link_destination" && !dest) dest = c
      }
      if (label && dest) {
        const raw = label.text.trim()
        const inner = raw.length >= 2 && raw.charCodeAt(0) === 91 && raw.charCodeAt(raw.length - 1) === 93 ? raw.slice(1, -1).trim() : raw
        if (inner && (dest.text ?? "").trim()) definitions.add(inner)
      }
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) defWalk(n.namedChild(i))
  }
  defWalk(tree.rootNode)

  const inlineBlocks: any[] = []
  const collect = (n: any) => {
    if (n.type === "inline") { inlineBlocks.push(n); return }
    for (let i = 0; i < n.namedChildCount; i++) collect(n.namedChild(i))
  }
  collect(tree.rootNode)

  for (const blk of inlineBlocks) {
    const sub = inlineParser.parse(blk.text)
    if (!sub) continue
    const walk = (n: any, inSpan: boolean) => {
      if (n.type === "link_destination" && !(inSpan || n.parent?.type === "code_span")) {
        const raw = (n.text ?? "").trim()
        if (raw.charCodeAt(0) !== 35) {
          // The owner is the nearest heading at or before this inline block, and the line
          // the analyzer records for a `uses` edge is the DESTINATION's file line.
          let owner = "document"
          for (const [ln, nm] of headingNamesByLine) { if (ln <= blk.startPosition.row + 1) owner = nm; else break }
          const at = blk.startPosition.row + 1 + (n.startPosition?.row ?? 0)
          const k = `${owner}\u0000${raw}\u0000${at}`
          if (seenDestinationKeys.has(k)) {
            T.duplicateDestinationNodes++
            T.duplicateDestinationFiles.add(key(f))
          } else {
            seenDestinationKeys.add(k)
          }
        }
      }
      const span = inSpan || n.type === "code_span"
      if (n.type === "link_destination") {
        if (span) { T.codeSpanWithDestination++; rec.codeSpansWithDest++ }
        else {
          T.linkDestination++; rec.treeLinks++
          const t = (n.text ?? "").trim()
          if (t.charCodeAt(0) === 35) {
            T.fragmentOnly++; rec.treeFragments++
            if (anchorMap.has(decodeFrag(t.slice(1)))) { T.fragmentsResolvableInFile++; rec.fragResolvable++ }
            else { T.fragmentsUnresolvableInFile++; rec.fragUnresolvable++ }
          }
        }
      }
      if (n.type === "uri_autolink") { T.uriAutolink++; rec.treeUris++ }
      if (n.type === "email_autolink") { T.emailAutolink++; rec.treeEmails++ }
      if (n.type === "full_reference_link" || n.type === "collapsed_reference_link" || n.type === "shortcut_link") {
        T.referenceLinkUses++; rec.refUses++
        const label = referenceLabelOf(n)
        if (label && definitions.has(label)) { T.referenceLinkUsesDefined++; rec.refUsesDefined++ }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), span)
    }
    walk(sub.rootNode, false)
    sub.delete?.()
  }
  perFile.push(rec)
  tree.delete?.()
}

function referenceLabelOf(n: any): string | undefined {
  let labelNode: any = null
  let textNode: any = null
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c.type === "link_label" && !labelNode) labelNode = c
    if (c.type === "link_text" && !textNode) textNode = c
  }
  const strip = (t: string) => {
    const s = t.trim()
    return s.length >= 2 && s.charCodeAt(0) === 91 && s.charCodeAt(s.length - 1) === 93 ? s.slice(1, -1).trim() : s
  }
  if (labelNode) { const t = strip(labelNode.text); if (t) return t }
  if (textNode) { const t = textNode.text.trim(); if (t) return t }
  return undefined
}

// ─────────────────────────────────────────────────────────── analyzer-side counters
const perFileEmitted = new Map<number, { link: number; autolink: number; anchor: number; heading: number }>()
let relLink = 0
let relAutolink = 0
let relAnchor = 0
let relContainsHeading = 0
let relAll = 0
let parsedFiles = 0
let parseFailures = 0
/** The residuals, attributed. A delta between the tree and what `parseFile` DELIVERED is
 *  not evidence about the analyzer until the pipeline has been excluded, because
 *  `parseFile` is downstream of `filterNoiseRelationships` and that filter deletes 4.33%
 *  of this lane's edges (see the pipeline-drop probe). So every file's PRE-filter result
 *  is computed too, and an expected edge missing from the delivered set is checked
 *  against the filter directly: if the filter drops it, the delta is the FILTER's and is
 *  named; if the filter keeps it, the delta is the ANALYZER's and stays unexplained. */
const roleCounts: Record<string, number> = {}
const typeCounts: Record<string, number> = {}

let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
    parsedFiles++
    const mine = perFileEmitted.get(i) ?? { link: 0, autolink: 0, anchor: 0, heading: 0 }
    for (const e of r.relationships ?? []) {
      relAll++
      const t = String(e.type ?? "")
      typeCounts[t] = (typeCounts[t] ?? 0) + 1
      const role = String(e.metadata?.role ?? "(absent)")
      roleCounts[role] = (roleCounts[role] ?? 0) + 1
      if (role === "markdown_link") { relLink++; mine.link++ }
      else if (role === "markdown_autolink") { relAutolink++; mine.autolink++ }
      else if (role === "markdown_internal_anchor") { relAnchor++; mine.anchor++ }
      else if (role === "heading_hierarchy") { relContainsHeading++; mine.heading++ }
    }
    perFileEmitted.set(i, mine)
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

/** The filter's rules, re-derived in the same order `filterNoiseRelationships` applies
 *  them. Deliberately a RE-DERIVATION rather than an import of its internals: the point
 *  is to attribute a delta to a named rule a reader can check, and a helper that called
 *  the filter would make "the filter dropped it" true by construction. */
const extractLeaf = (name: string): string => {
  const noLine = name.replace(/:\d+$/, "")
  const segments = noLine.split(":").filter((s) => s.length > 0)
  const last = segments[segments.length - 1] ?? ""
  const dotParts = last.split(".")
  return dotParts[dotParts.length - 1]
}
const rule = (target: string): string => {
  if (target.length > 200) return "target-over-200"
  if (target.includes("\n")) return "target-has-newline"
  const leaf = extractLeaf(target)
  if (leaf.length > 80) return "leaf-too-long"
  if (leaf.length < 1) return "leaf-too-short"
  if (/[{}`<>\n\r\t]/.test(leaf)) return "leaf-brace-angle-backtick"
  if (leaf.startsWith(" ")) return "leaf-starts-with-space"
  if (leaf.includes("  ")) return "leaf-double-space"
  return "NOT-DROPPED-BY-ANY-NAMED-RULE"
}

/**
 * The reconciliation is TWO-SIDED and exact, and deliberately not a pool walk.
 *
 *   T = edges the TREE says are eligible        (counted on the pinned wasms)
 *   A = edges the ANALYZER emitted, pre-filter  (`ASTEngine.parseFile`)
 *   D = edges the WORKER DELIVERED, post-filter (`pool-worker.parseFile`)
 *
 *   analyzer shortfall = T - A   a construct this lane does not read
 *   pipeline deletion  = A - D   an edge `filterNoiseRelationships` removed
 *
 * Two disjoint numbers with no remainder, which is what a reader needs in order to
 * decide whether a delta is this lane's defect or the shared filter's. The first version
 * of this probe reported the single number T - D, and an intermediate version attributed
 * it by walking the dropped pool once per row; that over-counted by 11, because one
 * dropped edge can satisfy more than one row's gap, and it still left 4 unattributed.
 * Splitting at A removes the ambiguity by construction rather than by a better fudge.
 */
const keyOfRel = (e: any): string => `${e.source}\u0000${e.type}\u0000${e.target}\u0000${e.line_number ?? 0}`
const analyzerShortfallByRule: Record<string, number> = {}
const analyzerShortfallExamples: string[] = []
let analyzerShortfall = 0
let analyzerShortfallUnlabelled = 0
let pipelineDeletion = 0
const pipelineByRule: Record<string, number> = {}
const pipelineByRole: Record<string, number> = {}
const pipelineExamples: string[] = []
let preTotalEdges = 0

let i2 = 0
async function attributeWorker(): Promise<void> {
  for (;;) {
    const i = i2++
    if (i >= draw.length) return
    const f = draw[i]
    let content: string
    try { content = readFileSync(f.abs, "utf8") } catch { continue }
    let pre: any
    let post: any
    try { pre = await ASTEngine.parseFile(f.abs, content) } catch { continue }
    try { post = await parseFile(f.abs, f.dir) } catch { continue }
    const rec = perFile[i]
    if (!rec) continue
    const preRels: any[] = pre.relationships ?? []
    preTotalEdges += preRels.length

    // ---- analyzer shortfall: T - A, per role this probe reconciles.
    const preRoleCount: Record<string, number> = {}
    const preRoleEdges: Record<string, any[]> = {}
    for (const e of preRels) {
      const ro = String(e.metadata?.role ?? "")
      preRoleCount[ro] = (preRoleCount[ro] ?? 0) + 1
      preRoleEdges[ro] = [...(preRoleEdges[ro] ?? []), e]
    }
    const treeExpected: Record<string, number> = {
      heading_hierarchy: rec.nestedExclEmpty,
      markdown_link: rec.treeLinks - rec.treeFragments + rec.refUsesDefined,
      markdown_internal_anchor: rec.fragResolvable,
    }
    for (const [ro, t] of Object.entries(treeExpected)) {
      const a = preRoleCount[ro] ?? 0
      let gap = t - a
      if (gap <= 0) continue
      // Name the shape of the edges the analyzer DID emit for this role, so a shortfall
      // is reported next to the population it sits in rather than as a bare number.
      // The shortfall is `t - a`, UNCONDITIONALLY. An earlier version added only what
      // was left after labelling `gap` units against the pool, so four real shortfalls
      // were absorbed by the walk and the total printed as 0 -- a number that said the
      // analyzer is exact when it was four short. The walk labels; it does not subtract.
      analyzerShortfall += gap
      const pool = preRoleEdges[ro] ?? []
      let cursor = 0
      while (gap > 0 && cursor < pool.length) {
        const why = rule(String(pool[cursor].target ?? ""))
        analyzerShortfallByRule[why] = (analyzerShortfallByRule[why] ?? 0) + 1
        if (analyzerShortfallExamples.length < 10) {
          analyzerShortfallExamples.push(
            `${ro} [pool edge shape: ${why}] "${String(pool[cursor].source).slice(0, 44)}" -> "${String(pool[cursor].target).slice(0, 60)}"`,
          )
        }
        gap--
        cursor++
      }
      if (gap > 0) analyzerShortfallUnlabelled += gap
    }

    // ---- pipeline deletion: A - D, every pre-filter edge the worker did not deliver.
    const delivered = new Set((post.relationships ?? []).map(keyOfRel))
    for (const e of preRels) {
      if (delivered.has(keyOfRel(e))) continue
      pipelineDeletion++
      const why = rule(String(e.target ?? ""))
      pipelineByRule[why] = (pipelineByRule[why] ?? 0) + 1
      const ro = String(e.metadata?.role ?? "(absent)")
      pipelineByRole[ro] = (pipelineByRole[ro] ?? 0) + 1
      if (pipelineExamples.length < 10) {
        pipelineExamples.push(`${ro} [${why}] "${String(e.source).slice(0, 44)}" -> "${String(e.target).slice(0, 60)}"`)
      }
    }
  }
}
await Promise.all(Array.from({ length: 4 }, () => attributeWorker()))

// ─────────────────────────────────────────────────────────── reconciliation
/** Every row states the tree count, the emitted count, and the mechanism that accounts
 *  for the difference. `unexplained` is the number that matters: it is what is left
 *  after every named mechanism is subtracted, and it is what a reader should treat as a
 *  candidate defect. */
const rows = [
  (() => {
    const treeNonFragment = T.linkDestination - T.fragmentOnly
    const expected = treeNonFragment + T.referenceLinkUsesDefined
    return {
      row: "uses / markdown_link",
      tree: treeNonFragment,
      emitted: relLink,
      mechanisms: [
        { name: "reference-link USES with a definition (no destination node of their own)", count: T.referenceLinkUsesDefined },
        { name: "reference-link USES with NO definition — MD-D1: literal text, not a link", count: T.referenceLinkUses - T.referenceLinkUsesDefined },
      ],
      expectedFromTree: expected,
      unexplained: expected - relLink,
      note: "a `full_reference_link` names only its label; the destination lives in a block-level `link_reference_definition`, so a reference link adds an edge and no inline node. An UNDEFINED reference is suppressed (MD-D1) and is the second mechanism, not a miss.",
    }
  })(),
  {
    row: "uses / markdown_autolink",
    tree: T.uriAutolink + T.emailAutolink,
    emitted: relAutolink,
    mechanisms: [],
    expectedFromTree: T.uriAutolink + T.emailAutolink,
    unexplained: T.uriAutolink + T.emailAutolink - relAutolink,
    note: "uri_autolink + email_autolink, one edge each.",
  },
  {
    row: "uses / markdown_internal_anchor",
    tree: T.fragmentOnly,
    emitted: relAnchor,
    mechanisms: [
      { name: "fragments resolving to no heading in this file — MD-D6: not published, count disclosed in metadata.patterns", count: T.fragmentsUnresolvableInFile },
    ],
    expectedFromTree: T.fragmentsResolvableInFile,
    unexplained: T.fragmentsResolvableInFile - relAnchor,
    note: "resolved PER FILE, under the renderer's own ordinal rule (`slug`, `slug-1`, `slug-2`), because the analyzer's anchor map is per file and a fragment naming another document's heading is its declared boundary.",
  },
  {
    row: "contains / heading_hierarchy",
    tree: T.headingsNestedIncludingEmpty,
    emitted: relContainsHeading,
    mechanisms: [
      { name: "nesting levels contributed ONLY by an EMPTY heading, which MD-D2 declines to publish (so its children attach to the nearest NAMED ancestor)", count: T.headingsNestedIncludingEmpty - T.headingsNestedExcludingEmpty },
    ],
    expectedFromTree: T.headingsNestedExcludingEmpty,
    unexplained: T.headingsNestedExcludingEmpty - relContainsHeading,
    note: "a child whose text EQUALS its parent's is NOT lost: the analyzer passes `distinctSites = ownerId !== id` on this edge precisely so `# Changelog` over `## Changelog` publishes (a child's id can never equal its parent's id, so the flag is always true here).",
  },
  {
    row: "code_span containing a link_destination",
    tree: T.codeSpanWithDestination,
    emitted: 0,
    mechanisms: [],
    expectedFromTree: 0,
    unexplained: T.codeSpanWithDestination,
    note: "a STRUCTURAL reachability claim, not an emission: the inline grammar gives code_span only ANONYMOUS children and the analyzer descends NAMED children only, so no destination is reachable beneath one. A non-zero tree count falsifies it.",
  },
]

const out = {
  instrument: "markdown edge-recall probe (validation/m14/fixtures/markdown/edge-recall-probe.ts)",
  entryPoint: "parseFile (src/ast/pool-worker.ts), compared against node counts on the pinned trees",
  corpusRoot: CR,
  seed: SEED,
  admittedMarkdownFiles: all.length,
  drawn: draw.length,
  drawHash,
  parsedFiles,
  parseFailures,
  relationshipsTotal: relAll,
  typeCounts,
  roleCounts,
  tree: T,
  twoSidedDecomposition: {
    note: "T = eligible nodes on the pinned trees; A = what the analyzer emitted PRE-filter (ASTEngine.parseFile); D = what the worker delivered POST-filter (pool-worker.parseFile). analyzerShortfall = T - A is a construct this lane does not read. pipelineDeletion = A - D is an edge filterNoiseRelationships removed. Two disjoint numbers, no remainder.",
    analyzerEdgesPreFilter: preTotalEdges,
    analyzerShortfall,
    analyzerShortfallUnlabelled,
    analyzerShortfallByRule,
    analyzerShortfallExamples,
    pipelineDeletion,
    pipelineDeletionByRule: pipelineByRule,
    pipelineDeletionByRole: pipelineByRole,
    pipelineDeletionExamples: pipelineExamples,
  },
  rows,
  perFileResidual: [...perFile]
    .map((r, i) => {
      const e = perFileEmitted.get(i) ?? { link: 0, autolink: 0, anchor: 0, heading: 0 }
      return {
        file: r.file,
        headingExpected: r.nestedExclEmpty,
        headingEmitted: e.heading,
        headingDelta: r.nestedExclEmpty - e.heading,
        linkExpected: r.treeLinks - r.treeFragments + r.refUsesDefined,
        linkEmitted: e.link,
        linkDelta: r.treeLinks - r.treeFragments + r.refUsesDefined - e.link,
        anchorExpected: r.fragResolvable,
        anchorEmitted: e.anchor,
        anchorDelta: r.fragResolvable - e.anchor,
      }
    })
    .filter((r) => r.headingDelta !== 0 || r.linkDelta !== 0 || r.anchorDelta !== 0)
    .sort((a, b) => (Math.abs(b.headingDelta) + Math.abs(b.linkDelta) + Math.abs(b.anchorDelta)) - (Math.abs(a.headingDelta) + Math.abs(a.linkDelta) + Math.abs(a.anchorDelta))),
  perFileWorstResidual: [...perFile]
    .map((r) => ({ file: r.file, treeLinks: r.treeLinks, nestedExclEmpty: r.nestedExclEmpty, fragUnresolvable: r.fragUnresolvable }))
    .filter((r) => r.fragUnresolvable > 0)
    .sort((a, b) => b.fragUnresolvable - a.fragUnresolvable)
    .slice(0, 5),
}

console.log(`markdown edge-recall probe — ${draw.length} files (seed ${SEED}, sha256=${drawHash.slice(0, 16)})`)
console.log(`parsed ${parsedFiles} (failures ${parseFailures}); ${relAll} relationships emitted`)
console.log("")
console.log(`${"row".padEnd(46)}${"tree".padStart(8)}${"expected".padStart(10)}${"emitted".padStart(9)}${"UNEXPL".padStart(8)}`)
console.log("-".repeat(81))
for (const r of rows) {
  console.log(`${r.row.padEnd(46)}${String(r.tree).padStart(8)}${String(r.expectedFromTree).padStart(10)}${String(r.emitted).padStart(9)}${String(r.unexplained).padStart(8)}`)
}
console.log("")
for (const r of rows) {
  console.log(`  ${r.row}`)
  for (const m of r.mechanisms) console.log(`    accounted  ${m.name}: ${m.count}`)
  console.log(`    unexplained ${r.unexplained}`)
  console.log(`    note       ${r.note}`)
}
console.log("")
console.log(`  tree vocabulary: headings ${T.headingsTotal} (empty ${T.emptyHeadings}), nested incl-empty ${T.headingsNestedIncludingEmpty}, excl-empty ${T.headingsNestedExcludingEmpty}`)
console.log(`  fragments ${T.fragmentOnly} (resolvable in file ${T.fragmentsResolvableInFile}, unresolvable ${T.fragmentsUnresolvableInFile})`)
console.log(`  reference-link uses ${T.referenceLinkUses} (defined ${T.referenceLinkUsesDefined}, undefined ${T.referenceLinkUses - T.referenceLinkUsesDefined})`)
console.log(`  duplicate (owner,target,line) destination nodes collapsed by addRel: ${T.duplicateDestinationNodes} in ${T.duplicateDestinationFiles.size} file(s)`)
console.log("")
console.log(`TWO-SIDED DECOMPOSITION of every delta above (T = tree, A = pre-filter, D = delivered):`)
console.log(`  analyzer shortfall (T - A): ${analyzerShortfall} (${analyzerShortfallUnlabelled} with no pool edge to label them)`)
for (const [k, v] of Object.entries(analyzerShortfallByRule).sort((a, b) => b[1] - a[1])) console.log(`      pool edge shape ${k.padEnd(32)} ${v}`)
console.log(`  pipeline deletion  (A - D): ${pipelineDeletion} of ${preTotalEdges} pre-filter edges`)
for (const [k, v] of Object.entries(pipelineByRule).sort((a, b) => b[1] - a[1])) console.log(`      ${k.padEnd(36)} ${v}`)
for (const [k, v] of Object.entries(pipelineByRole).sort((a, b) => b[1] - a[1])) console.log(`      role ${k.padEnd(33)} ${v}`)
for (const e of pipelineExamples.slice(0, 4)) console.log(`  [pipeline] ${e}`)
const resid = (out.perFileResidual as any[])
console.log("")
console.log(`FILES WITH A NON-ZERO PER-FILE RESIDUAL: ${resid.length} of ${perFile.length}`)
for (const r of resid.slice(0, 12)) {
  console.log(`  ${r.file}`)
  console.log(`     heading expected ${r.headingExpected} emitted ${r.headingEmitted} (delta ${r.headingDelta}) | link expected ${r.linkExpected} emitted ${r.linkEmitted} (delta ${r.linkDelta}) | anchor expected ${r.anchorExpected} emitted ${r.anchorEmitted} (delta ${r.anchorDelta})`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nwrote ${OUT}`)
}