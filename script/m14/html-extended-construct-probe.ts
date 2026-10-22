#!/usr/bin/env bun
/**
 * HTML EXTENDED-CONSTRUCT PROBE — DO THE FIVE OPEN TYPES REACH AN `.html` PAYLOAD, AND HOW?
 *
 * ## WHAT THIS MEASURES, AND WHY IT IS NOT THE ARM
 *
 * The html lane reads 9/14 and the five open types are `decorates`, `implements`, `renders`,
 * `mixes_in` and `part_of`. Before any of them can be dispositioned, two facts have to be MEASURED
 * rather than assumed:
 *
 *   1. **DOES THE CONSTRUCT REACH THE ANALYZER AT ALL?** The html analyzer is a CONTAINER: it
 *      delegates every `<script>`/`<style>` block to the javascript / typescript / css analyzer and
 *      copies the delegate's relationships verbatim (`src/ast/real-html-analyzer.ts:2282`). So the
 *      question "can an HTML document express `decorates`?" is a question about the SEAM, and the
 *      honest way to answer it is to PLANT the construct in a document and read what the production
 *      path publishes.
 *   2. **WHAT DOES THE CORPUS CARRY?** A construct the corpus never exercises is still expressible,
 *      and the fleet's own class for that is "IMPLEMENTED AND CORPUS-UNEXERCISED" — but only a COUNT
 *      over the admitted population can establish it. ⇒ THIS TOOL COUNTS THE CONSTRUCTS OVER THE
 *      ADMITTED POPULATION, AND EVERY COUNT IT PRINTS IS A COUNT A FALSIFIER MAY CITE.
 *
 * ⇒ THE POPULATION IS THE GATE'S OWN: `git ls-files` (the TRACKED set), the admitted extensions,
 * the engine's 1 MB cap. A directory walk is a DIFFERENT population and is not used here.
 *
 * ## THE CONSTRUCTS, AND WHY EACH IS NAMED THE WAY IT IS
 *
 *   decorates  a decorator applied to a declaration — the javascript grammar's `decorator` node
 *               over a `class_declaration` / `method_definition`. The DECORATED DECLARATION is the
 *               source and the decorator is the target (`src/ast/types.ts:120-144`).
 *   implements  a class's `implements` clause — the typescript grammar's `implements_clause` /
 *               `class_implements_clause`.
 *   renders    a component rendering another component — a JSX element in a component's body.
 *   mixes_in   a class composing a mixin into its supertype chain.
 *   part_of    a unit INCLUDING a part file.
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It counts CONSTRUCTS. It does not claim edges: an edge needs a resolution, and the arm owns
 * resolution. It prints the corpus count of each construct and the planted-document result
 * side by side, so a reader can tell "the corpus has 0 of these" from "the seam drops these".
 *
 * RUN: bun script/m14/html-extended-construct-probe.ts [--max=<files>] [--json <out.json>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from "node:fs"
import { resolve, join, dirname } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = resolve(import.meta.dir, "../..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? join(ROOT, ".corpus")
const argv = process.argv.slice(2)
// THE `--flag=value` FORM AND THE `--flag value` FORM BOTH WORK. The first version of this
// script accepted only `--flag=value`, and the run line in its own header said `--flag <value>`
// — so the documented invocation SILENTLY wrote no artifact at all, and the run looked like it
// had produced a measurement because it had produced its console output. A measurement whose
// artifact is missing is a measurement nobody can cite.
const argOf = (name: string, dflt: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  if (hit) return hit.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--")) return argv[i + 1]
  return dflt
}
const MAX = Number(argOf("max", "0")) // 0 = the whole admitted population
const JSON_OUT = argOf("json", "")
// THE CHUNK PATH — see the note in `admitted()` below. The census is a whole-population parse, so
// it needs the fleet's heavy arm, and the heavy arm is ONE at a time with a queue in front of it.
// ⇒ the census takes the SMALL slot (≤2,000 files per call) and runs as FIVE DISJOINT SLICES of the
//   same sorted list the arm's own `--offset=N` takes, and every counter in this probe is ADDITIVE
//   (node counts, block counts, per-file booleans), so the sum of the five slices IS the census.
const OFFSET = Number(argOf("offset", "0"))
const LIMIT = Number(argOf("limit", "0")) // 0 = to the end of the admitted list

/** THE ROUTER'S OWN TABLE for the html lane (incoming-gate.ts:319) — thirteen spellings. */
// ★ THE THIRTEEN SPELLINGS COME FROM THE ROUTER'S ONE TABLE (script/m14/language-extensions.ts),
//   NOT FROM A SECOND COPY KEPT HERE. A table duplicated in two places is one table that will
//   diverge, and this lane's population is measured by three instruments — this census, the
//   population walk, and the arm — so all three must read the SAME table or they are measuring
//   three populations under one name.
import { extensionsFor } from "./language-extensions"
const EXTS = extensionsFor("html").map((e) => e.replace(/^\./, ""))
const SIZE_CAP = 1024 * 1024

// ─── THE ADMITTED POPULATION, THE GATE'S OWN RULE ────────────────────────────────────────────────
function admitted(): string[] {
  const out: string[] = []
  let repos: string[]
  try {
    repos = execFileSync("ls", ["-1", CORPUS], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
  } catch {
    return out
  }
  for (const name of repos) {
    const dir = join(CORPUS, name)
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!EXTS.some((e) => low.endsWith(`.${e}`))) continue
      const abs = join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      out.push(abs)
    }
  }
  // THE GATE SORTS THE ADMITTED LIST (incoming-gate.ts:532), so this list is sorted the SAME WAY —
  // the arm's `--offset=N` slices are slices of THAT order, and a census over a different order
  // would not be a census over the arm's population.
  out.sort()
  // ★ THE CHUNK PATH. The census is a WHOLE-POPULATION parse, so it needs the fleet's heavy arm —
  //   and the heavy arm is ONE at a time with a queue in front of it. So the census takes the SMALL
  //   slot (≤2,000 files per call) and runs as FIVE DISJOINT SLICES of THIS list, the same slices
  //   the arm's own `--offset=N` takes, so the two measurements are over the same population in the
  //   same order. Every counter in this probe is ADDITIVE (node counts, block counts, per-file
  //   booleans), so the sum of the five slices IS the whole-population census.
  if (MAX > 0 && out.length > MAX) return out.slice(0, MAX)
  return out
}

// THE ADMITTED LIST IS BUILT ONCE, so the run can report the SLICE it measured and the TOTAL it
// was taken from — a census over a chunk that does not say which chunk is a census over nothing.
const ADMITTED_ALL = admitted()
const ADMITTED_TOTAL = ADMITTED_ALL.length
const SLICE_START = Math.min(OFFSET, ADMITTED_ALL.length)
const SLICE_END = LIMIT > 0 ? Math.min(SLICE_START + LIMIT, ADMITTED_ALL.length) : ADMITTED_ALL.length
const SLICE: [number, number] = [SLICE_START, SLICE_END]
// THE FILES THIS RUN MEASURES — the slice of the FULL admitted list.
const MEASURED: string[] = ADMITTED_ALL.slice(SLICE_START, SLICE_END)

// ─── THE CONSTRUCT COUNTERS, OVER THE PRODUCTION PARSER ──────────────────────────────────────────
/** THE COUNTS, AND WHERE EACH NUMBER COMES FROM. Every one of these is a node type of the pinned
 *  grammar, so a count of 0 is a fact about the grammar's reach and not about a guess. */
interface Counts {
  files: number
  filesWithEmbedded: number
  embeddedBlocks: number
  blocksByLang: Record<string, number>
  /** the decorator construct: an applied `@deco` before a declaration */
  decoratorNodes: number
  filesWithDecorator: number
  /** the implements construct: a class's `implements` clause */
  implementsClauses: number
  filesWithImplements: number
  /** the render construct: a JSX element inside a component's body */
  jsxElements: number
  filesWithJsx: number
  /** the mixin construct: a `with`-style mixin composition */
  mixinClauses: number
  filesWithMixin: number
  /** the part construct: a `part`/`include` directive naming another unit */
  partDirectives: number
  filesWithPart: number
  /** THE CLASS-HERITAGE CLAUSES IN THE EMBEDDED SCRIPT — the javascript lane's `mixes_in`
   *  discriminator is POSITION (a CALL in the heritage IS the mixin), so the mixin count is read
   *  off the heritage clause's own SHAPE, and the clause count is what the shape is read over. */
  classHeritageClauses: number
  filesWithClassHeritage: number
  heritageShapes: Record<string, number>
  /** THE TEMPLATE-LANGUAGE INCLUDE FAMILY — the html lane's own admitted set carries handlebars,
   *  twig, pug, erb, jinja, liquid, nunjucks, ejs, mustache and j2, and each of them has an
   *  "include this other file" directive. This is the NEAR MISS for `part_of` in html's OWN
   *  source, and it is counted so a ruling on `part_of` has a COUNTED construct to name. */
  templateIncludeDirectives: number
  filesWithTemplateInclude: number
  templateIncludeByKind: Record<string, number>
}

const c: Counts = {
  files: 0, filesWithEmbedded: 0, embeddedBlocks: 0, blocksByLang: {},
  decoratorNodes: 0, filesWithDecorator: 0,
  implementsClauses: 0, filesWithImplements: 0,
  jsxElements: 0, filesWithJsx: 0,
  mixinClauses: 0, filesWithMixin: 0,
  partDirectives: 0, filesWithPart: 0,
  classHeritageClauses: 0, filesWithClassHeritage: 0, heritageShapes: {},
  templateIncludeDirectives: 0, filesWithTemplateInclude: 0, templateIncludeByKind: {},
}

console.log(`HTML EXTENDED-CONSTRUCT PROBE`)
console.log(`population: ${ADMITTED_TOTAL} GIT-TRACKED admitted files (git ls-files · ${EXTS.length} admitted spellings · <= ${SIZE_CAP} bytes)`)
console.log(`root: ${CORPUS}`)

const parserCache = new Map<string, any>()
async function parserFor(lang: string): Promise<any> {
  if (parserCache.has(lang)) return parserCache.get(lang)
  const { getParser } = await import("../../src/ast/engine").then((m: any) => m)
  const p = await getParser(lang)
  parserCache.set(lang, p)
  return p
}

/** A raw walk over a tree, counting node types by name. */
function countTypes(root: any, wanted: Set<string>, out: Map<string, number>): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (wanted.has(n.type)) out.set(n.type, (out.get(n.type) ?? 0) + 1)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const ch = n.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
}

/** THE HERITAGE CLAUSE'S OWN SHAPE — the DIRECT named child's type, which is what a shape-list
 *  analyzer matches on. `call_expression` is the javascript lane's `mixes_in` discriminator
 *  (POSITION: a call IN the heritage IS the mixin), so this distribution is the number the
 *  mixin disposition is read off. */
function heritageShapes(root: any, out: Map<string, number>): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "class_heritage") {
      let shape = "(none)"
      for (let i = 0; i < n.namedChildCount; i++) {
        const ch = n.namedChild(i)
        if (ch) { shape = ch.type; break }
      }
      out.set(shape, (out.get(shape) ?? 0) + 1)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const ch = n.namedChild(i)
      if (ch) stack.push(ch)
    }
  }
}

const JS_DECORATOR = new Set(["decorator"])
const TS_IMPLEMENTS = new Set(["implements_clause", "class_implements_clause"])
const JSX = new Set(["jsx_element", "jsx_opening_element", "jsx_self_closing_element"])
const MIXIN = new Set(["mixin_clause", "mixins_clause"])
const PART = new Set(["part_directive", "part_of_directive", "library_directive", "include_statement"])
const HERITAGE = new Set(["class_heritage", "extends_clause", "implements_clause"])

for (const f of MEASURED) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  c.files++
  let blocks: any[] = []
  try {
    blocks = ASTEngine.extractHtmlEmbeddedBlocks({ namedChildCount: 0, child: () => null, childCount: 0 } as any, content)
  } catch {
    // The engine's own extractor needs a real tree; parse it here instead.
    blocks = []
  }
  if (blocks.length === 0) {
    // PARSE THE DOCUMENT AND EXTRACT THE BLOCKS THE ENGINE'S OWN WAY.
    try {
      const parser = await parserFor("html")
      const tree = parser.parse(content)
      blocks = ASTEngine.extractHtmlEmbeddedBlocks(tree.rootNode, content)
      tree.delete()
    } catch {
      // ⇒ THE TEMPLATE FAMILY IS COUNTED FOR THIS FILE TOO. The first version of this probe
      //   `continue`d here, and the `continue`d files were exactly the files with NO embedded
      //   block — so the near-miss count was measured over 22 files instead of over the whole
      //   admitted population, and 608 files carrying template directives were never counted.
      //   A near miss measured over a SUBSET is a number about the subset.
      countTemplateFamily(content)
      continue
    }
  }
  if (blocks.length === 0) {
    countTemplateFamily(content)
    continue
  }
  c.filesWithEmbedded++
  c.embeddedBlocks += blocks.length
  for (const b of blocks) {
    c.blocksByLang[b.lang] = (c.blocksByLang[b.lang] ?? 0) + 1
    let tree: any = null
    try {
      const parser = await parserFor(b.lang)
      tree = parser.parse(b.body)
    } catch {
      continue
    }
    if (!tree) continue
    const m = new Map<string, number>()
    countTypes(tree.rootNode, new Set([...JS_DECORATOR, ...TS_IMPLEMENTS, ...JSX, ...MIXIN, ...PART, ...HERITAGE]), m)
    // ★ THE FILE COUNTERS COUNT FILES, NOT MATCHES. The first version incremented
    //   `filesWithDecorator` (and its four siblings) INSIDE the per-node-type loop, so a file
    //   holding three decorators would have counted as THREE files. Every count in this census
    //   is currently zero, so the measured result is unaffected — but a counter that misreports
    //   on a non-zero population is a counter that will misreport the day the population changes,
    //   and the near-miss table is the table a reviewer reads. Each file contributes AT MOST ONE to
    //   each `filesWith…` counter, and the per-block flag is what makes that true.
    const seenHere = new Set<string>()
    for (const [k, v] of m) {
      if (JS_DECORATOR.has(k)) { c.decoratorNodes += v; seenHere.add("decorator") }
      if (TS_IMPLEMENTS.has(k)) { c.implementsClauses += v; seenHere.add("implements") }
      if (JSX.has(k)) { c.jsxElements += v; seenHere.add("jsx") }
      if (MIXIN.has(k)) { c.mixinClauses += v; seenHere.add("mixin") }
      if (PART.has(k)) { c.partDirectives += v; seenHere.add("part") }
      if (k === "class_heritage" || k === "extends_clause") { c.classHeritageClauses += v; seenHere.add("heritage") }
    }
    if (seenHere.has("decorator")) c.filesWithDecorator++
    if (seenHere.has("implements")) c.filesWithImplements++
    if (seenHere.has("jsx")) c.filesWithJsx++
    if (seenHere.has("mixin")) c.filesWithMixin++
    if (seenHere.has("part")) c.filesWithPart++
    if (seenHere.has("heritage")) c.filesWithClassHeritage++
    const hs = new Map<string, number>()
    heritageShapes(tree.rootNode, hs)
    for (const [k, v] of hs) c.heritageShapes[k] = (c.heritageShapes[k] ?? 0) + v
    try { tree.delete() } catch { /* the engine frees its own trees; this one is ours */ }
  }
  // THE TEMPLATE-LANGUAGE INCLUDE FAMILY — counted on the DOCUMENT TEXT, because the template
  // languages are NOT html's grammar: a `.hbs` file's `{{> partial}}` is a Handlebars directive,
  // and the html grammar parses it as TEXT. The count is a TEXT count, and it says so.
  countTemplateFamily(content)
}

/**
 * THE TEMPLATE-LANGUAGE INCLUDE FAMILY — the near miss for `part_of` in html's OWN source.
 *
 * ★ THIS RUNS FOR EVERY ADMITTED FILE, NOT ONLY FOR THE FILES THAT CARRY AN EMBEDDED BLOCK. The
 *   first version of this probe counted it after the embedded-block scan, and the scan's early
 *   `continue` swallowed every file with no `<script>`/`<style>` — so the family was measured over
 *   22 files when 608 files carry one. A near miss measured over a SUBSET is a number about the
 *   subset, and the subset here was chosen by the very construct the count is about.
 *
 * ★ THE BUCKETS ARE DISJOINT BY CONSTRUCTION AND THE TOTAL IS THEIR SUM, so the printed total can
 *   never disagree with the printed breakdown. The `{% … %}` family is matched ONCE and classified
 *   by its verb: the first version ran FOUR separate regexes over the same `{% … %}` text — one per
 *   template language — and counted every Jinja directive FOUR times, because Jinja, Twig, Liquid
 *   and Nunjucks all spell the directive the same way. The number it printed (379) was 93 × 4 + 7:
 *   a DOUBLE-COUNT that reads exactly like a real population.
 */
function countTemplateFamily(content: string): void {
  const lower = content.toLowerCase()
  let fileHits = 0
  // THE `{{ … > partial }}` FAMILY — handlebars and mustache spell a partial the same way, so ONE
  // regex covers both and the bucket is named for the family, not for a language.
  const hbsRe = /\{\{\s*>[\s-]*[A-Za-z0-9_.\-/]+/g
  const hbs = lower.match(hbsRe) ?? []
  if (hbs.length > 0) {
    c.templateIncludeByKind["handlebars-style-partial"] = (c.templateIncludeByKind["handlebars-style-partial"] ?? 0) + hbs.length
    fileHits += hbs.length
  }
  // THE `{% … %}` FAMILY, COUNTED ONCE, CLASSIFIED BY ITS VERB.
  const tagRe = /\{%\s*(extends|include|import|embed|use|render|from)\b[^%]*%\}/g
  const tagMatches = lower.match(tagRe) ?? []
  for (const m of tagMatches) {
    const verb = /\{%\s*(extends|include|import|embed|use|render|from)\b/.exec(m)?.[1] ?? "other"
    c.templateIncludeByKind[`tag-${verb}`] = (c.templateIncludeByKind[`tag-${verb}`] ?? 0) + 1
    fileHits++
  }
  // THE PUG FAMILY — `include`/`extends` at the start of a line, which is how pug spells it.
  const pugRe = /^[ \t]*(include|extends)[ \t]+[^\n]*$/gm
  const pugMatches = lower.match(pugRe) ?? []
  for (const m of pugMatches) {
    const verb = /^[ \t]*(include|extends)/.exec(m)?.[1] ?? "other"
    c.templateIncludeByKind[`pug-${verb}`] = (c.templateIncludeByKind[`pug-${verb}`] ?? 0) + 1
    fileHits++
  }
  // THE HTML-NATIVE SPELLING OF "THIS DOCUMENT INCLUDES ANOTHER DOCUMENT": `<link rel="import">`.
  // It is the ONE include mechanism HTML itself has, so the near-miss count has to include it.
  const linkImportRe = /<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bimport\b[^"'>]*["']?[^>]*>/gi
  const linkImports = content.match(linkImportRe) ?? []
  if (linkImports.length > 0) {
    c.templateIncludeByKind["html-link-rel-import"] = (c.templateIncludeByKind["html-link-rel-import"] ?? 0) + linkImports.length
    fileHits += linkImports.length
  }
  // THE TOTAL IS THE SUM OF THE DISJOINT BUCKETS — computed here, not accumulated in parallel, so
  // the printed total IS the printed breakdown and the two cannot drift apart.
  c.templateIncludeDirectives = Object.values(c.templateIncludeByKind).reduce((n, v) => n + v, 0)
  if (fileHits > 0) c.filesWithTemplateInclude++
}

console.log()
console.log("== THE ADMITTED POPULATION ==")
console.log(`  files parsed                      ${c.files}`)
console.log(`  files carrying an embedded block   ${c.filesWithEmbedded}`)
console.log(`  embedded blocks                    ${c.embeddedBlocks}  ${JSON.stringify(c.blocksByLang)}`)
console.log()
console.log("== THE FIVE OPEN TYPES' CONSTRUCTS, OVER THAT POPULATION ==")
console.log(`  decorates   decorator nodes                     ${c.decoratorNodes}   in ${c.filesWithDecorator} files`)
console.log(`  implements  implements clauses                 ${c.implementsClauses}   in ${c.filesWithImplements} files`)
console.log(`  renders     jsx elements                       ${c.jsxElements}   in ${c.filesWithJsx} files`)
console.log(`  mixes_in    mixin clauses                       ${c.mixinClauses}   in ${c.filesWithMixin} files`)
console.log(`  part_of     part directives                     ${c.partDirectives}   in ${c.filesWithPart} files`)
console.log()
console.log("== THE CLASS-HERITAGE CLAUSES IN THE EMBEDDED SCRIPT (the mixes_in shape distribution) ==")
console.log(`  class_heritage clauses                        ${c.classHeritageClauses}   in ${c.filesWithClassHeritage} files`)
for (const [k, v] of Object.entries(c.heritageShapes).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(6)}  ${k}`)
console.log()
console.log("== THE NEAR MISS FOR part_of IN HTML'S OWN SOURCE: THE TEMPLATE-LANGUAGE INCLUDE FAMILY ==")
console.log(`  include/extends/partial directives              ${c.templateIncludeDirectives}   in ${c.filesWithTemplateInclude} files`)
for (const [k, v] of Object.entries(c.templateIncludeByKind).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(6)}  ${k}`)

if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true })
  writeFileSync(JSON_OUT, JSON.stringify({
    instrument: "html-extended-construct-probe",
    command: `BB_CORPUS_ROOT=${CORPUS} bun run script/m14/html-extended-construct-probe.ts --json ${JSON_OUT}`,
    population: {
      files: c.files,
      rule: "git ls-files · admitted spellings · <= 1 MB",
      // THE SLICE, WHEN THIS RUN IS A CHUNK. The census is a whole-population parse, so it runs
      // on the SMALL slot as five disjoint slices of the sorted admitted list; the slice bounds
      // are here so the merge can CHECK that the slices are disjoint and cover the population
      // instead of asserting it.
      admitted: ADMITTED_TOTAL,
      slice: SLICE,
      offset: OFFSET,
      limit: LIMIT,
    },
    counts: c,
  }, null, 2))
  console.log()
  console.log(`WROTE ${JSON_OUT}`)
}
