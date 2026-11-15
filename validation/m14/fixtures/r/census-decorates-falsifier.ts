#!/usr/bin/env npx tsx
/**
 * FALSIFIER CENSUS — the two named constructs of the `decorates` ruling, COUNTED.
 *
 * A ruling is earned by a measurement, and a falsifier that names a construct nothing counts
 * is not a falsifier — it is a sentence (the csharp lane's lesson, and the reason
 * `cs.attribute_argument_call` exists). The R lane's `decorates` ruling names TWO constructs
 * its falsifier would have to produce, and this instrument counts both over the whole
 * admitted population and over the served grammar's own inventory:
 *
 *   1. AN ANNOTATION PRODUCTION IN THE SERVED GRAMMAR WHOSE NODE WRAPS A DECLARATION —
 *      counted among the served build's own named node types. Roxygen is a COMMENT in the
 *      grammar (the `comment` node type is in the served list), and a comment NODE wraps a
 *      declaration in no grammar sense: the R grammar attaches no declaration to it. If the
 *      grammar grew such a production, this census would name it.
 *
 *   2. A ROXYGEN TAG A TOOL INVOKES ON THE DECLARATION AT BUILD TIME — counted as the tag
 *      SITES, and separately as the tag sites that sit ABOVE a declaration. This is the
 *      shape a `decorates` row would need: not "a comment mentions a tag" but "a tool
 *      APPLIES that tag to the declaration the comment precedes at build time". The census
 *      measures how many roxygen sites are adjacent to a declaration so the ruling states
 *      the opportunity precisely rather than treating all 59,334 sites as one class.
 *
 * The declaration-adjacency test is AST-structural, never textual: a roxygen comment is
 * "adjacent" when the next named node after it in the same parent is the declaration the
 * analyzer publishes — the same `extractDocstring` relation the analyzer itself uses.
 *
 * Run: BB_CORPUS_ROOT=$PWD/.corpus npx tsx validation/m14/fixtures/r/census-decorates-falsifier.ts
 * Artifact: validation/m14/fixtures/r/measurements/r-decorates-falsifier.txt
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { ASTEngine } from "../../../../src/ast/engine"
import { extensionsFor } from "../../../../script/m14/language-extensions"

const T0 = Date.now()
const loadAtStart = os.loadavg()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACT = path.resolve(HERE, "measurements", "r-decorates-falsifier.txt")

const LANE = "r"
const EXTS = extensionsFor(LANE).map((e) => e.replace(/^\./, ""))
const SIZE_CAP = 1024 * 1024
function admit(rel: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXTS.some((e) => low.endsWith(`.${e}`))) return true
  return EXTS.some((e) => base === e) && detectLanguageFromPath(rel) === LANE
}

interface Admitted { repo: string; rel: string; abs: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR).sort()) {
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
  for (const rel of tracked) {
    if (!admit(rel)) continue
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > SIZE_CAP) continue
    admitted.push({ repo: e, rel, abs })
  }
}
admitted.sort((a, b) => a.abs.localeCompare(b.abs))
const corpusDigest = createHash("sha256").update(admitted.map((c) => c.abs).join("\n")).digest("hex")

// --- the served grammar's own inventory: the annotation-production falsifier target ------
const grammar = JSON.parse(readFileSync(path.resolve(HERE, "..", "..", "..", "..", "validation", "m14", "measurements", "r-grammar-nodes.json"), "utf8")) as {
  servedDigest: string; namedTypes: number; namedTypeNames: string[]; allTypeNames: string[]
}
const named = grammar.namedTypeNames
// A production whose NODE wraps a declaration: any named type whose name mentions the
// annotation/decorator/attribute/roxygen/tag family. Counted, so the claim "0 among 41" is
// this census's own reading of the inventory the registry serves.
const ANN_WORDS = ["annot", "decor", "attribute", "roxy", "tag"]
const annotationFamily = named.filter((n) => ANN_WORDS.some((w) => n.toLowerCase().includes(w)))
const commentIsNamed = named.includes("comment")

// --- the roxygen walk --------------------------------------------------------------------
let parsed = 0, failures = 0, retriedFiles = 0
const TRAP_ATTEMPTS = 3
let roxygenSites = 0
let roxygenTagSites = 0
const roxygenFiles = new Set<string>()
/** roxygen sites whose next named sibling is a declaration the analyzer publishes. */
let adjacentToDeclaration = 0
let adjacentFiles = new Set<string>()

function isRoxygen(n: any): boolean {
  const t = n?.text ?? ""
  return t.length >= 2 && t.charCodeAt(0) === 35 && t.charCodeAt(1) === 39
}

function wordsOf(text: string): string[] {
  const out: string[] = []
  let start = -1
  for (let i = 0; i <= text.length; i++) {
    const c = i < text.length ? text.charCodeAt(i) : 32
    const isSpace = c === 32 || c === 9 || c === 10 || c === 13 || c === 40 || c === 41 || c === 44
    if (isSpace) { if (start >= 0) { out.push(text.slice(start, i)); start = -1 } } else if (start < 0) start = i
  }
  return out
}

const TAGS = ["@export", "@import", "@importFrom", "@importClassesFrom", "@importMethodsFrom", "@useDynLib", "@rdname", "@examples", "@param", "@return", "@name", "@title", "@description", "@details", "@seealso", "@references", "@note", "@section", "@docType", "@concept", "@keywords", "@method", "@slot", "@field", "@format", "@author", "@source", "@exportClass", "@exportMethod", "@exportS3Method", "@inheritParams", "@inheritDotParams", "@template", "@include", "@order", "@encoding", "@language", "@family"]

/** Is `n` a node the analyzer publishes a DECLARATION from? (the shapes handleBinaryOperator/handleCall read) */
function isDeclarationShape(n: any): boolean {
  if (!n) return false
  // `x <- function(...)`, `Cls <- R6Class(...)`, `Gen <- setGeneric(...)` — the assignment form.
  if (n.type === "binary_operator") {
    const op = n.childForFieldName("operator")?.text
    if (op === "<-" || op === "=" || op === "<<-") {
      const lhs = n.childForFieldName("lhs")
      return lhs?.type === "identifier"
    }
  }
  // `setClass`, `setRefClass`, `setGeneric`, `setMethod`, `setValidity` statements.
  if (n.type === "call") {
    const fn = n.namedChild?.(0)
    const name = fn?.type === "identifier" ? fn.text : (fn?.type === "namespace_operator" ? fn.namedChild?.(1)?.text : "")
    return ["setClass", "setRefClass", "setGeneric", "setMethod", "setValidity"].includes(String(name))
  }
  return false
}

async function walkOne(f: Admitted) {
  const key = `${f.repo}/${f.rel}`
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { failures++; return }
  let tree: any = null
  for (let attempt = 1; attempt <= TRAP_ATTEMPTS && !tree; attempt++) {
    try {
      const r = await ASTEngine.parseTree(f.abs, text)
      tree = r?.tree ?? null
      if (tree && attempt > 1) retriedFiles++
    } catch { if (attempt === TRAP_ATTEMPTS) { failures++ } }
  }
  if (!tree) return
  parsed++
  const root = tree.rootNode
  // A comment's NEXT named sibling in the same parent, for declaration adjacency.
  const stack: any[] = [{ node: root, parent: null as any, index: -1 }]
  while (stack.length) {
    const frame: any = stack.pop()
    const n = frame.node
    if (!n) continue
    if (n.type === "comment" && isRoxygen(n)) {
      roxygenSites++
      roxygenFiles.add(key)
      const tags = wordsOf(n.text).filter((w) => TAGS.some((t) => w === t || (w.startsWith(t) && w.length === t.length)))
      if (tags.length > 0) roxygenTagSites += tags.length
      // adjacency: the next named node in the SAME parent.
      //
      // INDEX comparison, not wrapper identity — tree-sitter builds a fresh JS wrapper per
      // `namedChild()` call, so `parent.namedChild(i) === n` is ALWAYS false and the first
      // version of this census read 0 adjacent sites for a shape the probe shows is
      // ubiquitous (a roxygen block and its declaration are consecutive program children).
      // The same trap the analyzer's R5 fix hit, caught here before any ruling cited the 0.
      const parent = n.parent
      if (parent) {
        const total = parent.namedChildCount
        let found = -1
        for (let i = 0; i < total; i++) {
          const cand = parent.namedChild(i)
          if (cand && cand.startIndex === n.startIndex && cand.endIndex === n.endIndex && cand.type === n.type) { found = i; break }
        }
        if (found >= 0) {
          for (let j = found + 1; j < total; j++) {
            const sib = parent.namedChild(j)
            if (!sib) continue
            if (sib.type === "comment") continue // a following roxygen line continues the block
            if (isDeclarationShape(sib)) {
              adjacentToDeclaration++
              adjacentFiles.add(key)
            }
            break
          }
        }
      }
    }
    for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) {
      const ch = n.namedChild(i)
      if (ch) stack.push({ node: ch })
    }
  }
  try { tree.delete?.() } catch { /* best effort */ }
}

let cursor = 0
const WORKERS = Number(process.env.BB_R_WORKERS ?? "4")
async function worker() {
  while (cursor < admitted.length) {
    const i = cursor++
    await walkOne(admitted[i])
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const out: string[] = []
const line = "=".repeat(78)
out.push(line)
out.push("FALSIFIER CENSUS — the `decorates` ruling's TWO NAMED CONSTRUCTS, COUNTED")
out.push(line)
out.push(`node ${process.version}   workers ${WORKERS}   cores ${os.cpus().length}`)
out.push(`load at start: ${loadAtStart.map((n) => n.toFixed(2)).join(" ")}`)
out.push(`corpus root: ${CR}`)
out.push(`admission: the GATE's predicate (script/m14/incoming-gate.ts:367) — .${EXTS.join(", .")} + bare basename clause, SIZE_CAP ${SIZE_CAP} B`)
out.push(`admitted files [0,${admitted.length}) of ${admitted.length}`)
out.push(`corpus file set: sha256 ${corpusDigest}`)
out.push(`files parsed: ${parsed}   failures: ${failures}   (wasm-trap retries: ${retriedFiles})`)
out.push("")
out.push("FALSIFIER 1 — an annotation production in the SERVED grammar whose node wraps a declaration:")
out.push(`  served grammar digest: ${grammar.servedDigest} (validation/m14/measurements/r-grammar-nodes.json)`)
out.push(`  named node types served: ${grammar.namedTypes}`)
out.push(`  annotation/decorator/attribute/roxygen/tag-family named types among them: ${annotationFamily.length}`)
if (annotationFamily.length) for (const n of annotationFamily) out.push(`    ${n}`)
out.push(`  the ` + "`comment`" + ` node type IS named in the served list: ${commentIsNamed}`)
out.push(`  -> roxygen is a COMMENT in this grammar, and a comment node wraps a declaration in no grammar sense.`)
out.push("")
out.push("FALSIFIER 2 — a roxygen tag a tool INVOKES on the declaration at build time:")
out.push(`  roxygen ` + "`#'`" + ` comment sites: ${roxygenSites}`)
out.push(`  files carrying roxygen: ${roxygenFiles.size}`)
out.push(`  tag sites (@export, @import*, @param, ...): ${roxygenTagSites}`)
out.push(`  roxygen sites whose next named sibling is a DECLARATION shape: ${adjacentToDeclaration}`)
out.push(`  files with such adjacent sites: ${adjacentFiles.size}`)
out.push(`  -> the tags sit on comments that PRECEDE declarations, and roxygen2 reads them from`)
out.push(`     SOURCE TEXT at package BUILD time; nothing in the R grammar attaches the tag to the`)
out.push(`     declaration as a node. The opportunity is counted, so the ruling does not treat all`)
out.push(`     sites as one undifferentiated class.`)
out.push(line)
const report = out.join("\n") + "\n"
try { writeFileSync(ARTIFACT, report) } catch (e: any) { process.stderr.write(`ARTIFACT WRITE FAILED: ${e?.message ?? e}\n`) }
process.stderr.write(report)
process.on("exit", (code) => process.stderr.write(`EXIT code=${code} after ${Date.now() - T0}ms\n`))
process.exitCode = 0
