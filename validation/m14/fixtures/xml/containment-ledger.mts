/**
 * CONTAINMENT LEDGER — the coverage question asked of `contains` and `imports`.
 *
 * ## THE QUESTION
 *
 * `script/m14/xml-ruled.ts` gives `extends` a site ledger (1,652 XSD derivation sites on
 * the tree against 438 edges, and 1,615 covered / 37 refused / 0 edges with no site behind
 * them). `derivation-accounting.mts` extended that to `calls` and to `references` source
 * authenticity. Two of the six emitted types still had NO instrument:
 *
 *   contains   186,270 edges   the highest-volume type in the lane, Q3 "unmeasured"
 *   imports        465 edges   Q3 "unmeasured"
 *
 * A `contains` edge asserts one thing: **the target is inside the source.** That is a claim
 * about two byte ranges, and it is checkable against tree parentage without re-deriving a
 * single naming decision — which is the trap every other oracle in this repo walks into.
 * `src/ast/real-xml-analyzer.ts` builds `declaredNames` in SEVEN places and this file uses
 * none of them: it takes the analyzer's symbol RANGES (parse facts) and the analyzer's
 * EDGES, then asks the tree whether the ranges nest.
 *
 * ## WHAT IT MEASURES, IN BOTH DIRECTIONS
 *
 *   A. Every emitted edge, tested. CONFIRMED when some symbol named `target` has its span
 *      strictly inside the span of some symbol named `source`. Anything else is classified
 *      by observable shape — the serious direction, because an edge no site supports is
 *      the fabricated-edge class the lane doc says is the most expensive mistake available.
 *   B. Every real nesting, tested the other way. For each symbol, the symbols whose spans
 *      enclose it. A (source, target) name pair that nests and has NO edge is a MISSED
 *      containment — the recall direction, which a resolution rate cannot see either.
 *   C. `imports` sites. Every path the tree carries in an `ExternalID` literal, a PI
 *      `href`, or a `schemaLocation` token list is enumerated, and each is matched to an
 *      edge by (source name, target path). Edges with no site and sites with no edge are
 *      both counted.
 *
 * ## WHAT IT CANNOT FIND, STATED UP FRONT
 *
 *   CANNOT prove any edge is CORRECT. This is a coverage ledger, not an oracle: it proves
 *        each edge has a real nesting behind it, which is necessary and not sufficient.
 *   CANNOT see a grammar-level fault. It is a second walker over the SAME `tree-sitter-xml`
 *        as the analyzer, so a construct the grammar drops is invisible to both. This is
 *        the limitation `script/m14/differential.ts` exists to break and it cannot break it
 *        for xml: `LANG_REPOS` has no `xml` entry, so no independent oracle has ever
 *        adjudicated any XML edge (lane doc §8 item 4).
 *   CANNOT re-derive the naming rules, by design. Identity is taken from the analyzer's
 *        symbol set, so a systematically mis-named symbol would be confirmed here. The
 *        check is on the SPANS, not on the names.
 *
 * ## CLI
 *   npx tsx validation/m14/fixtures/xml/containment-ledger.mts
 *   BB_LEDGER_MAX=2000   bound the file count (0 = the whole admitted population)
 *   BB_XML_WORKERS=1     production parseFile concurrency; 1 by default because the
 *                        arbiter's own runs show the counts move above 1 (§countsAreDeterministic)
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WORKERS = Number(process.env.BB_XML_WORKERS ?? "1")
const MAX_FILES = Number(process.env.BB_LEDGER_MAX ?? "0")
const HERE = import.meta.dirname
const OUT = path.join(HERE, "containment-ledger.json")

const { parseFile } = (await import("../../../../src/ast/pool-worker")) as any
const { detectLanguageFromPath } = (await import("../../../../src/ast/language-detection")) as any

// ── corpus discovery: the gate's rule, copied EXACTLY ─────────────────────────
// git-tracked files only, a 512 KiB cap, and `detectLanguageFromPath(abs, text)` with the
// CONTENT as a second argument. All three are load-bearing: a probe that draws a different
// population than the arbiter measured reports a ratio against someone else's numerator.
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
console.error(`containment-ledger: ${admitted.length} admitted files (${admittedTotal} discovered), ${WORKERS} worker(s)`)
if (admittedTotal === 0) throw new Error("no files admitted — the corpus root is wrong")

// ── phase 1 — production symbols and edges ────────────────────────────────────
/** A symbol reduced to what the tree can check: a NAME and a SPAN.
 *
 *  `parseFile` returns the WORKER's flat shape — `startLine` / `endLine` / `startIndex` /
 *  `endIndex` are top-level fields, not nested under `range`. The first run of this file
 *  read `s.range?.startIndex`, which is `undefined` on every symbol, and printed
 *  `29,639 symbols without a span` and `B-target-symbol-absent` on 4,383 of 4,383 edges —
 *  a total, confident, entirely fictional result. It is the same wrong-field-name class the
 *  `from`/`to` mistake below is; the shape is asserted rather than hedged, because a probe
 *  that reads two possible shapes reports the union and hides which one it got. */
type Sym = { name: string; kind: string; lo: number; hi: number; line: number }
type Edge = { from: string; to: string; role: string; line: number | undefined }

const symsByFile = new Map<string, Sym[]>()
const containsByFile = new Map<string, Edge[]>()
const importsByFile = new Map<string, Edge[]>()
let noSpanSymbols = 0
let parseErrs = 0
let fallbackFiles = 0
let cursor = 0
let sawFlatShape = false

const worker = async (): Promise<void> => {
  for (;;) {
    const i = cursor++
    if (i >= admitted.length) return
    const f = admitted[i]
    const label = `${f.repo}/${f.rel}`
    // `parseFile(filePath, projectPath)` — the second argument is the PROJECT path.
    // Passing the text there typechecks (both strings) and silently hands parseFile a
    // projectPath that does not exist; this is the second time this lane made that swap.
    const r = await parseFile(f.abs, f.dir)
    if (r?.fallback === true) fallbackFiles++
    if (Array.isArray(r?.errors) && r.errors.length > 0) parseErrs++
    const syms: Sym[] = []
    for (const s of r.symbols ?? []) {
      if (typeof s.startIndex === "number") sawFlatShape = true
      const lo = s.startIndex
      const hi = s.endIndex
      if (typeof lo !== "number" || typeof hi !== "number") {
        noSpanSymbols++
        continue
      }
      syms.push({ name: s.name, kind: String(s.kind ?? s.type), lo, hi, line: s.startLine })
    }
    if (syms.length > 0) symsByFile.set(label, syms)
    const cEdges: Edge[] = []
    const iEdges: Edge[] = []
    for (const rel of r.relationships ?? []) {
      // The endpoint fields are `source` and `target`. `from`/`to` exist on the type and
      // are always undefined, so reading them yields `undefined -> undefined` and a result
      // that looks like a fabrication.
      const from = rel.source as string
      const to = rel.target as string
      const role = String((rel.metadata as any)?.role ?? "")
      const line = (rel as any).line
      if (rel.type === "contains") cEdges.push({ from, to, role, line })
      else if (rel.type === "imports") iEdges.push({ from, to, role, line })
    }
    if (cEdges.length > 0) containsByFile.set(label, cEdges)
    if (iEdges.length > 0) importsByFile.set(label, iEdges)
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))
console.error(`phase 1: ${[...containsByFile.values()].reduce((a, l) => a + l.length, 0)} contains edges, ${[...importsByFile.values()].reduce((a, l) => a + l.length, 0)} imports edges; ${fallbackFiles} fallback files, ${noSpanSymbols} symbols without a span`)

// ── phase 2 — the tree ───────────────────────────────────────────────────────
//
// THE PARSER LIFETIME IS A MEASUREMENT, NOT A STYLE CHOICE, and this block is the
// second thing this lane got wrong here.
//
// It used to build ONE `web-tree-sitter` parser and call `parser.parse(text)` 11,552
// times, keeping every tree alive. Measured on the current corpus by
// `validation/m14/fixtures/xml/parser-lifetime.mts`:
//
//   ONE reused parser : failures=11552 of 11552, firstFailureAtIndex=8513
//   FRESH parser each  : ok=0 parseFail=0 newParserThrew=11552 firstThrowAtIndex=0
//
// Read the first line carefully: the parser served documents 0..8512 and then failed
// on EVERY one of the remaining 3,039. `unparsedByOwnParser` was 3,039. Those are the
// same 3,039. It was never a property of the corpus — it is the point at which the
// wasm heap can no longer grow, so the failure is permanent rather than per-file.
//
// The second line is why the obvious repair does not work either: by the time a
// fresh `Parser()` is attempted the heap is already spent, so it throws at index 0.
// Once the wasm module is exhausted, nothing in-process recovers it.
//
// So this walk now goes through `ASTEngine.parseTree`, which is the SAME entry the
// production analyzers get their tree from, and which deletes each tree in a `finally`
// (src/ast/engine.ts:1972-1981) and keeps its parsers in an evicting pool
// (src/ast/engine.ts:189-195). Phase 1 already calls `parseFile`, so the edge walk and
// the site walk now share one parser discipline instead of two.
//
// WHAT THIS WAS HIDING, and it is not small: every site-side number in this report —
// `contains` confirmation, `imports` sites, `containsRecall` candidate pairs — was
// computed over the first 8,513 documents of a sorted 11,552-file population and
// silently truncated at the heap boundary. `sitesOnTree` read 186 when the population
// carried more, and the file ordering decides which documents those are, so the
// truncation moved whenever the corpus grew: 234 sites at 11,464 admitted files,
// 186 at 11,552. Two of this lane's own numbers disagreed for a reason that had
// nothing to do with the analyzer.
const { ASTEngine } = (await import("../../../../src/ast/engine")) as any

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
/** Whitespace splitting with no regular expression: the tokenizer is a loop over
 *  `isSpace`, which is what `String.prototype.trim` already uses internally and what the
 *  analyzer's own `splitOnWhitespace` does. */
const splitOnWhitespace = (value: string): string[] => {
  const out: string[] = []
  let start = -1
  for (let i = 0; i < value.length; i++) {
    const space = value[i] === " " || value[i] === "\t" || value[i] === "\n" || value[i] === "\r"
    if (!space && start < 0) start = i
    if (space && start >= 0) {
      out.push(value.slice(start, i))
      start = -1
    }
  }
  if (start >= 0) out.push(value.slice(start))
  return out
}
const hasScheme = (v: string): boolean => {
  const colon = v.indexOf(":")
  if (colon <= 0) return false
  for (let i = 0; i < colon; i++) {
    const c = v.charCodeAt(i)
    const schemeChar = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46
    if (!schemeChar) return false
  }
  return true
}

// ── A. every emitted `contains` edge, tested against span nesting ─────────────
/**
 * `confirmed` needs only two facts read off the analyzer's own output and one comparison:
 * does a symbol named `target` sit strictly inside a symbol named `source`? Every other
 * class is reported with the observation that produced it, so a non-confirmed edge can be
 * adjudicated by reading the file rather than by trusting a label.
 */
type EdgeCls =
  | "A-confirmed"
  | "B-target-symbol-absent"
  | "C-source-symbol-absent"
  | "D-spans-disjoint"
  | "E-target-outside-source"
  | "G-spans-explainable-by-a-collision"
const edgeByCls = new Map<EdgeCls, { edges: number; files: number; examples: string[] }>()
const bumpEdge = (c: EdgeCls, file: string, ex: string): void => {
  const row = edgeByCls.get(c) ?? { edges: 0, files: 0, examples: [] }
  row.edges++
  if (!row.examples.includes(file)) row.files++
  if (row.examples.length < 6) row.examples.push(ex)
  edgeByCls.set(c, row)
}
const byRoleThenCls = new Map<string, Map<EdgeCls, number>>()
/** Name -> spans. Several symbols can share a name (every match-based `xsl:template`
 *  publishes `xsl:template`), so a name maps to a LIST and the check is existential. */
const spansByName = (syms: Sym[]): Map<string, number[][]> => {
  const m = new Map<string, number[][]>()
  for (const s of syms) {
    const list = m.get(s.name) ?? []
    list.push([s.lo, s.hi])
    m.set(s.name, list)
  }
  return m
}
/** "span" -> the names occupying it. A span held by two names is the collision the
 *  `G` class is named for, and it is counted in its own right because it is visible to
 *  every range-based consumer, not only to this probe. */
const collisionsByFile = new Map<string, { spans: number }>()
const collisionNames = new Map<string, number>()
/**
 * SPAN COLLISIONS, over EVERY file that published a symbol — not over the files that
 * happened to carry a `contains` edge. The first version counted them inside the edge
 * loop, so a file with symbols and no `contains` edge contributed nothing, and this
 * artifact reported 0 collisions on 400 files while
 * `declaration-span-before-after.mts` reported 154 on the same 400. Both were right about
 * their own population and the two numbers were not comparable, which is the defect: two
 * of this lane's own instruments quoting different figures for a named property.
 */
const collisionPairsByFile = new Map<string, Set<string>>()
for (const [label, syms] of symsByFile) {
  const namesBySpan = new Map<string, Set<string>>()
  for (const s of syms) {
    const set = namesBySpan.get(`${s.lo}\u0000${s.hi}`) ?? new Set<string>()
    set.add(s.name)
    namesBySpan.set(`${s.lo}\u0000${s.hi}`, set)
  }
  let collidedSpans = 0
  /** Every ORDERED name pair that shares one span. An edge (a -> b) lands in this set when
   *  a and b occupy the identical byte range, which is the only way `a -contains-> b` can
   *  be true and simultaneously invisible to a nesting test. */
  const pairs = new Set<string>()
  for (const set of namesBySpan.values()) {
    if (set.size < 2) continue
    collidedSpans++
    const names = [...set].sort()
    collisionNames.set(names.join(" + "), (collisionNames.get(names.join(" + ")) ?? 0) + 1)
    for (const a of names) for (const b of names) if (a !== b) pairs.add(`${a}\u0000${b}`)
  }
  collisionsByFile.set(label, { spans: collidedSpans })
  collisionPairsByFile.set(label, pairs)
}

const containsTotal = { edges: 0, files: 0 }
for (const [label, edges] of containsByFile) {
  const syms = symsByFile.get(label) ?? []
  const spans = spansByName(syms)
  const collisionSpans = collisionPairsByFile.get(label) ?? new Set<string>()
  containsTotal.edges += edges.length
  containsTotal.files++
  for (const e of edges) {
    const targets = spans.get(e.to)
    const sources = spans.get(e.from)
    let cls: EdgeCls
    let note = ""
    if (!targets) {
      cls = "B-target-symbol-absent"
    } else if (!sources) {
      cls = "C-source-symbol-absent"
    } else {
      let ok = false
      let disjoint = false
      for (const [tlo, thi] of targets) {
        for (const [slo, shi] of sources) {
          if (tlo >= slo && thi <= shi && (tlo > slo || thi < shi)) {
            ok = true
            break
          }
          if (thi <= slo || tlo >= shi) disjoint = true
        }
        if (ok) break
      }
      // A containment claim that is not visible in the spans is not automatically a
      // false claim. The mechanism that hides it here is a SPAN COLLISION: two symbols
      // with DIFFERENT names occupying the identical byte range, so neither can nest
      // inside the other. That is what `src/ast/real-xml-analyzer.ts:2583` produces for
      // a same-line declaration — `anchor = valueNode.startPosition.row !==
      // node.startPosition.row ? valueNode : node` — where the declaration symbol's range
      // becomes the `name=` Attribute node and the ATTRIBUTE symbol's range is that same
      // node. So `boolean -contains-> name` is TRUE and unverifiable, and the class says
      // which it is rather than letting the reader guess from a count.
      const collided = !ok && collisionSpans.has(`${e.from}\u0000${e.to}`)
      if (ok) cls = "A-confirmed"
      else if (collided) {
        cls = "G-spans-explainable-by-a-collision"
        note = `target ${e.to} source ${e.from} share one span`
      } else if (disjoint) {
        cls = "D-spans-disjoint"
        const t = targets[0]!
        const s2 = sources[0]!
        note = `target ${e.to}@${t[0]}-${t[1]} source ${e.from}@${s2[0]}-${s2[1]}`
      } else {
        cls = "E-target-outside-source"
        const t = targets[0]!
        const s2 = sources[0]!
        note = `target ${e.to}@${t[0]}-${t[1]} source ${e.from}@${s2[0]}-${s2[1]}`
      }
    }
    const role = e.role || "<none>"
    const perRole = byRoleThenCls.get(role) ?? new Map<EdgeCls, number>()
    perRole.set(cls, (perRole.get(cls) ?? 0) + 1)
    byRoleThenCls.set(role, perRole)
    const where = note ? ` (${note})` : e.line !== undefined ? ` line ${e.line}` : ""
    bumpEdge(cls, label, `${label}  ${e.from} -contains-> ${e.to} role=${role}${where}`)
  }
}
const cls = (c: EdgeCls) => edgeByCls.get(c)?.edges ?? 0
const confirmed = cls("A-confirmed")

// ── B. every real nesting, tested the other way ──────────────────────────────
/**
 * The recall direction. For each symbol, every symbol whose span strictly encloses it gives
 * a candidate (source, target) name pair; a pair with no edge is a containment the tree
 * shows and the graph does not carry. Reported by the KIND pair and by the nearest
 * enclosing ELEMENT tag, so the classes can be adjudicated — a class of misses that is all
 * `class`-in-`class` under one tag is a different finding from one spread over 40 tags.
 */
type MissRow = { sourceKind: string; targetKind: string; nearestTag: string; pairs: number }
const missByPair = new Map<string, MissRow>()
const nestingCandidates = { pairs: 0 }
const missExamples: string[] = []

/** `imports` SITES — every path the tree carries, read from the grammar's own nodes.
 *  Declared before the single tree pass that fills both `tagStartsByFile` and `impSites`,
 *  because a `const` below its first use is a temporal-dead-zone throw and this file has
 *  already died on that twice elsewhere in the lane. */
type ImpSite = { file: string; kind: string; owner: string; path: string; line: number; nodeText: string }
const impSites: ImpSite[] = []
const unparsed: string[] = []
const tagStartsByFile = new Map<string, [number, number, string][]>()

/** The owner NAME an `imports` edge is written against, read from the tree the same way the
 *  analyzer reads it: walk up to the nearest element carrying a name, preferring a written
 *  `name=` attribute over the tag, and fall back to the DOCTYPE's own name.
 *
 *  Kept deliberately coarse. An `imports` edge's SOURCE resolves at 100 % in the census, so
 *  the source is not what is under test here — the PATH is, and the path is matched exactly.
 *  A disagreement in the OWNER shows up as a site with no edge, which is the class a reader
 *  adjudicates rather than one this probe resolves. */
const tagName = (tag: any): string => {
  const raw = directChild(tag, "Name")?.text.trim() ?? ""
  return raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw
}
const ownerNameFor = (node: any, rootName: string): string => {
  let n = node.parent
  while (n) {
    if (n.type === "element") {
      const tag = n.children.find((c: any) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
      const nameNode = tag ? directChild(tag, "Name") : null
      if (nameNode) {
        for (let i = 0; i < tag.namedChildCount; i++) {
          const a = tag.namedChild(i)
          if (a?.type !== "Attribute") continue
          if (directChild(a, "Name")?.text.trim() !== "name") continue
          const v = directChild(a, "AttValue")?.text
          if (v) return unquote(v).trim()
        }
        return tagName(tag)
      }
    }
    if (n.type === "doctypedecl") {
      const dn = directChild(n, "Name")
      if (dn) return dn.text.trim()
    }
    n = n.parent
  }
  return rootName
}

for (const f of admitted) {
  const label = `${f.repo}/${f.rel}`
  let tree: any
  try {
    tree = (await ASTEngine.parseTree(f.abs, f.text)).tree
  } catch {
    unparsed.push(label)
    continue
  }
  const root = tree?.rootNode
  if (!root) {
    unparsed.push(label)
    if (tree && typeof tree.delete === "function") {
      try {
        tree.delete()
      } catch {
        /* already released */
      }
    }
    continue
  }
  const tagStarts: [number, number, string][] = []
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
    if (n.type === "ExternalID") {
      const lit = directChild(n, "SystemLiteral") ?? directChild(n, "PubidLiteral")
      if (!lit) continue
      const p = unquote(lit.text).trim()
      if (p) impSites.push({ file: label, kind: directChild(n, "SystemLiteral") ? "system" : "public", owner: ownerNameFor(n, ""), path: p, line: lit.startPosition.row + 1, nodeText: n.text.slice(0, 60) })
      continue
    }
    if (n.type === "StyleSheetPI" || n.type === "XmlModelPI") {
      const piLabel = n.type === "StyleSheetPI" ? "xml-stylesheet" : "xml-model"
      for (let i = 0; i < n.namedChildCount; i++) {
        const p = n.namedChild(i)
        if (p?.type !== "PseudoAtt") continue
        if (directChild(p, "Name")?.text.trim() !== "href") continue
        const v = directChild(p, "PseudoAttValue")
        const raw = v?.text
        if (!raw) continue
        const value = unquote(raw).trim()
        if (value) impSites.push({ file: label, kind: piLabel, owner: piLabel, path: value, line: (v.startPosition?.row ?? n.startPosition.row) + 1, nodeText: n.text.slice(0, 60) })
      }
      continue
    }
    if (n.type !== "element") continue
    const tag = n.children.find((c: any) => c && (c.type === "STag" || c.type === "EmptyElemTag"))
    if (!tag) continue
    const written = directChild(tag, "Name")?.text.trim()
    if (written) tagStarts.push([n.startIndex, n.endIndex, written])
    for (let i = 0; i < tag.namedChildCount; i++) {
      const a = tag.namedChild(i)
      if (a?.type !== "Attribute") continue
      if (directChild(a, "Name")?.text.trim() !== "schemaLocation") continue
      const valueNode = directChild(a, "AttValue")
      const raw = valueNode?.text
      if (!raw) continue
      const parts = splitOnWhitespace(unquote(raw).trim())
      const paired = parts.length % 2 === 0 && parts.length >= 2
      for (let k = paired ? 1 : 0; k < parts.length; k += paired ? 2 : 1) {
        const p = parts[k]!
        if (!p) continue
        impSites.push({ file: label, kind: "schemaLocation", owner: ownerNameFor(n, tagName(tag)), path: p, line: (valueNode?.startPosition?.row ?? 0) + 1, nodeText: n.text.slice(0, 60) })
      }
    }
  }
  tagStarts.sort((a, b) => a[0] - b[0])
  tagStartsByFile.set(label, tagStarts)
  // The tree is released here, in the same shape as src/ast/engine.ts:1972-1981. Holding
  // all 11,552 is what exhausted the heap in the first place; this one line is the fix.
  if (tree && typeof tree.delete === "function") {
    try {
      tree.delete()
    } catch {
      /* already released */
    }
  }
}

for (const [label, syms] of symsByFile) {
  const edgePairs = new Set<string>()
  for (const e of containsByFile.get(label) ?? []) edgePairs.add(`${e.from}\u0000${e.to}`)
  const ordered = [...syms].sort((a, b) => a.lo - b.lo || b.hi - a.hi)
  const tags = tagStartsByFile.get(label) ?? []
  /** The nearest ENCLOSING element, not merely the nearest preceding one: a tag that
   *  starts before `lo` but ENDS before it is a sibling that closed, and labelling a miss
   *  with a closed sibling's tag would put every class in the artifact under the wrong
   *  element. Ties on start are broken by the longest span, which is the inner one in
   *  well-nested XML. */
  const nearestTagFor = (lo: number, hi: number): string => {
    let best = ""
    let bestStart = -1
    let bestSpan = -1
    for (const [start, end, name] of tags) {
      if (start > lo) break
      if (end < hi) continue
      const span = end - start
      if (start > bestStart || (start === bestStart && span > bestSpan)) {
        best = name
        bestStart = start
        bestSpan = span
      }
    }
    return best
  }
  for (const t of ordered) {
    // The IMMEDIATE enclosing symbol only. A span-nested symbol three levels up is an
    // ANCESTOR, not an owner: `contains` in this analyzer is parent-to-child by
    // construction (`ownerName` is threaded one level down at a time), so counting every
    // enclosing ancestor as a candidate asserts a `contains` edge the type has never
    // claimed to carry and manufactures a 45,000-edge "recall gap" out of correct
    // behaviour. The first version of this probe did exactly that and printed 45,179
    // misses on 300 files; the number below is the one with the semantics stated.
    let owner: Sym | undefined
    for (const s of ordered) {
      if (s === t) continue
      if (!(t.lo >= s.lo && t.hi <= s.hi && (t.lo > s.lo || t.hi < s.hi))) continue
      if (!owner) {
        owner = s
        continue
      }
      // A TIGHTER enclosure: it starts later, or at the same place and is shorter.
      if (s.lo > owner.lo || (s.lo === owner.lo && s.hi < owner.hi)) owner = s
    }
    if (!owner) continue
    nestingCandidates.pairs++
    if (edgePairs.has(`${owner.name}\u0000${t.name}`)) continue
    const nearest = nearestTagFor(t.lo, t.hi)
    const key = `${owner.kind}\u0000${t.kind}\u0000${nearest || "<none>"}`
    const row = missByPair.get(key) ?? { sourceKind: owner.kind, targetKind: t.kind, nearestTag: nearest || "<none>", pairs: 0 }
    row.pairs++
    missByPair.set(key, row)
    if (missExamples.length < 30) missExamples.push(`${label}  ${owner.name}(${owner.kind}) -contains-> ${t.name}(${t.kind}) under <${nearest || "none"}> tag=${t.name === "" ? "<empty>" : "ok"}`)
  }
}
const missRows = [...missByPair.values()].sort((a, b) => b.pairs - a.pairs)

// ── C. `imports` SITES, matched to edges ──────────────────────────────────────
/**
 * The sites the tree carries are enumerated from the grammar's own nodes, in the single
 * traversal above:
 *
 *   - `ExternalID` -> `SystemLiteral` / `PubidLiteral`  (a DOCTYPE or entity external id)
 *   - `PseudoAtt href` on `StyleSheetPI` / `XmlModelPI`  (`<?xml-stylesheet href=…?>`)
 *   - a `schemaLocation` attribute's token list, odd-index tokens when the count is even
 *     (the namespace/URI PAIR spelling of XSD 1.0 Part 1 §4.2.2) and every token when it
 *     is odd (a bare URI)
 *
 * The odd/even decision is the analyzer's, and it is re-derived here on purpose: it is a
 * property of the TOKEN COUNT, not of the analyzer's intent, so a probe that copied the
 * branch structure would be checking itself. What is NOT re-derived is `isRemoteUri` — a
 * site with no edge is reported as a site with no edge, and whether each refusal was right
 * is adjudicated from the corpus rows rather than assumed.
 */

/**
 * Match a site to an edge by TARGET PATH within the file, and report owner agreement
 * SEPARATELY.
 *
 * Keying on (owner, path) was the first version and it produced 270 of 465 edges
 * "with no site" at full population — a number that reads as a catastrophic fabricated-edge
 * finding and is entirely an artefact of this probe. The analyzer's `ownerName` for an
 * `xs:include` is the written tag `xs:include`, because `include` carries no `name=` and is
 * not a named declaration, while `ownerNameFor` here reduces a tag to its local part and so
 * writes `include`. Every `schemaLocation` edge then failed to match its own site.
 *
 * The separation matters because the two questions have different owners: the PATH is what
 * this instrument is for (is the target a file the document actually names?), and the OWNER
 * is Q5's `resolvedSource`, which the census already measures at 100.0 % for `imports`.
 * Folding them together let a naming difference in a probe be reported as a defect in an
 * analyzer. `ownerAgreement` is reported so the difference is visible rather than gone.
 */
const edgePairsFor = (label: string): Set<string> => {
  const s = new Set<string>()
  for (const e of importsByFile.get(label) ?? []) s.add(`${e.to}`)
  return s
}
/** Owners as the EDGE states them, so owner agreement is countable rather than asserted. */
const edgeOwnerFor = (label: string): Map<string, Set<string>> => {
  const m = new Map<string, Set<string>>()
  for (const e of importsByFile.get(label) ?? []) {
    const set = m.get(e.to) ?? new Set<string>()
    set.add(e.from)
    m.set(e.to, set)
  }
  return m
}
const impEdges = { edges: 0, files: 0, filesWithEdges: 0 }
const siteMatched = new Map<string, number>()
let siteTotal = 0
let siteWithNoEdge = 0
let siteNoEdgeHasScheme = 0
const siteNoEdgeExamples: string[] = []
let edgesWithNoSite = 0
let edgeHasSite = 0
let siteOwnerAgrees = 0
let siteOwnerDiffers = 0
const edgeNoSiteExamples: string[] = []
for (const [label, edges] of importsByFile) {
  impEdges.edges += edges.length
  impEdges.files++
  const pairs = edgePairsFor(label)
  const owners = edgeOwnerFor(label)
  const sites = impSites.filter((s) => s.file === label)
  const siteKeys = new Set(sites.map((s) => s.path))
  for (const s of sites) {
    siteTotal++
    if (pairs.has(s.path)) {
      siteMatched.set(s.kind, (siteMatched.get(s.kind) ?? 0) + 1)
      const edgeOwners = owners.get(s.path)
      if (edgeOwners?.has(s.owner)) siteOwnerAgrees++
      else siteOwnerDiffers++
    } else {
      siteWithNoEdge++
      if (hasScheme(s.path)) siteNoEdgeHasScheme++
      if (siteNoEdgeExamples.length < 25) siteNoEdgeExamples.push(`${label}:${s.line} ${s.kind} ${s.owner} -> ${s.path}`)
    }
  }
  for (const e of edges) {
    if (siteKeys.has(e.to)) {
      edgeHasSite++
      continue
    }
    edgesWithNoSite++
    if (edgeNoSiteExamples.length < 25) edgeNoSiteExamples.push(`${label}: ${e.from} -imports-> ${e.to} role=${e.role || "<none>"}`)
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const report = {
  generatedBy: "validation/m14/fixtures/xml/containment-ledger.mts",
  question: "does every emitted contains/imports edge have a real site behind it on the parse tree, and is any real site missing from the graph",
  corpus: {
    root: CR,
    admittedTotal,
    admitted: admitted.length,
    workers: WORKERS,
    method: "git-tracked files only, 512 KiB cap, detectLanguageFromPath(abs, text) — the gate's own rule, so the population is the population the arbiter measured",
    fallbackFiles,
    filesWithParseErrors: parseErrs,
    unparsedByOwnParser: unparsed.length,
    unparsedExamples: unparsed.slice(0, 5),
    sawFlatSymbolShape: sawFlatShape,
  },
  contains: {
    edges: containsTotal.edges,
    files: containsTotal.files,
    confirmed,
    confirmedRate: containsTotal.edges === 0 ? null : confirmed / containsTotal.edges,
    byClass: Object.fromEntries([...edgeByCls.entries()].map(([k, v]) => [k, { edges: v.edges, files: v.files, examples: v.examples }])),
    byRole: Object.fromEntries([...byRoleThenCls.entries()].map(([role, m]) => [role, Object.fromEntries(m)])),
    symbolsWithoutSpan: noSpanSymbols,
    spanCollisions: {
      note: "byte ranges held by TWO OR MORE distinct symbol names, over every file that published a symbol. Invisible to a nesting test and visible to every range-based consumer (LSP goto-definition resolves one span to one symbol).",
      population: "every file with at least one symbol, NOT only files carrying a contains edge — so this figure is comparable with declaration-span-before-after.mts",
      spans: [...collisionsByFile.values()].reduce((a, r) => a + r.spans, 0),
      files: [...collisionsByFile.values()].filter((r) => r.spans > 0).length,
      byNameCombination: Object.fromEntries([...collisionNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)),
    },
  },
  containsRecall: {
    note: "for each symbol, its IMMEDIATE enclosing symbol by span nesting, and whether a contains edge carries that (source, target) name pair. Deeper ancestors are not candidates: contains is parent-to-child by construction.",
    candidatePairs: nestingCandidates.pairs,
    pairsWithNoEdge: missRows.reduce((a, r) => a + r.pairs, 0),
    topMissClasses: missRows.slice(0, 40),
    missExamples,
  },
  imports: {
    edges: impEdges.edges,
    files: impEdges.files,
    sitesOnTree: siteTotal,
    sitesWithAnEdge: siteTotal - siteWithNoEdge,
    sitesWithNoEdge: siteWithNoEdge,
    ofThoseWithAUriScheme: siteNoEdgeHasScheme,
    sitesWithNoEdgeExamples: siteNoEdgeExamples,
    edgesWithNoSite: edgesWithNoSite,
    edgesWithSite: edgeHasSite,
    edgesWithNoSiteExamples: edgeNoSiteExamples,
    matchedByKind: Object.fromEntries(siteMatched),
    ownerAgreement: {
      note: "sites whose path matched an edge AND whose owner matched the edge's source name. A disagreement here is a NAMING difference between this probe and the analyzer (see `ownerNameFor`), not a defect in either: the census measures `imports` resolvedSource at 100 %, and the source is not what this instrument is for.",
      agrees: siteOwnerAgrees,
      differs: siteOwnerDiffers,
    },
  },
  limitations: [
    "This is a COVERAGE LEDGER, not an oracle: it proves each edge has a real nesting or a real path behind it. It does not prove the edge is the right LABEL or the right endpoint choice.",
    "It is a second walker over the same tree-sitter-xml as the analyzer, so a grammar-level fault is invisible to both. script/m14/differential.ts has no xml entry in LANG_REPOS, so no independent oracle has adjudicated any XML edge.",
    "Identity is taken from the analyzer's symbol set. A systematically mis-NAMED symbol is confirmed here; the check is on spans, not on names. Naming is covered by the source-authenticity ledger in derivation-accounting.mts.",
    "The imports half re-derives the odd/even pairing rule for schemaLocation because it is a property of the token count. It deliberately does NOT re-derive isRemoteUri, so a refused remote URI shows up as a site with no edge for adjudication.",
  ],
}
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
console.error(`wrote ${OUT}`)
console.log(
  [
    `contains  edges=${report.contains.edges}  confirmed=${confirmed}  rate=${report.contains.confirmedRate?.toFixed(4)}`,
    `contains  spans held by 2+ names: ${report.contains.spanCollisions.spans} in ${report.contains.spanCollisions.files} files`,
    ...[...edgeByCls.entries()].map(([k, v]) => `  ${k.padEnd(28)} ${String(v.edges).padStart(8)} edges / ${v.files} files`),
    `contains recall  candidate span pairs=${nestingCandidates.pairs}  pairs with no edge=${report.containsRecall.pairsWithNoEdge}`,
    ...missRows.slice(0, 8).map((r) => `  miss ${r.sourceKind}->${r.targetKind} under <${r.nearestTag}>  ${r.pairs}`),
    ...missExamples.slice(0, 6).map((e) => `    ${e}`),
    `imports  edges=${impEdges.edges}  sites=${siteTotal}  sites with no edge=${siteWithNoEdge} (${siteNoEdgeHasScheme} carry a URI scheme)  edges with no site=${edgesWithNoSite}  owner agrees/differs=${siteOwnerAgrees}/${siteOwnerDiffers}`,
  ].join("\n"),
)
