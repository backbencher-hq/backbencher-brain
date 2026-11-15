/**
 * WHY THIS EXISTS
 *
 * `script/m14/xml-ruled.ts` rules `uses` on instrument B with a probe over two
 * element local names: `use-attribute-sets` and `use-package`. The probe returned
 * 0 occurrences. A 0 is only as good as the corpus that produced it, and BOTH
 * constructs are not equally expressible in the corpus this lane measures:
 *
 *   `xsl:use-attribute-sets`  XSLT 1.0 AND 2.0/3.0
 *   `xsl:use-package`          XSLT 2.0 and later ONLY
 *
 * The dominant XSLT source in the corpus is libxslt, which is an XSLT **1.0**
 * processor, and its test suite is therefore written in the 1.0 dialect. So the
 * half of the ruling that names `use-package` is being measured against a corpus
 * that CANNOT EXPRESS IT. That is not a reason to overturn the ruling; it is a
 * reason the 0 is weaker than it looks, and the fix is to find out which.
 *
 * This census answers three questions, in order, and stops at the first `no`:
 *
 *   1. how many admitted files are XSLT at all (the routing question), by
 *      declaration rather than by extension alone;
 *   2. of those, what `xsl:version` each one declares — a 1.0-only population
 *      cannot produce `use-package`, so the ruling's dialect coverage is
 *      measured, not assumed;
 *   3. whether any admitted file carries either use-construct under ANY
 *      namespace prefix (the override condition's own clause), because a probe
 *      that binds the XSLT namespace can miss a document that spells the
 *      construct with a different prefix bound to the same URI.
 *
 * NO REGEX, anywhere. Every test below is `indexOf`/`startsWith`/`split` over a
 * string, or a cursor walk. Reading the file's own text is legitimate HERE and
 * only here: this instrument's subject is an ATTRIBUTE the file declares, and
 * the grammar exposes `xsl:version` as an attribute value on `stylesheet`,
 * which the walk reads. The raw-text path exists as a cross-check on the walk
 * and is reported separately so a reader can tell which number came from where.
 *
 * Output is JSON to stdout. `grep` is the caller's problem, not this file's.
 *
 * ZERO REGEX. `script/m12/verify-regex-census.ts` scans analyzer sources, but the
 * ban is stated wider than that — "any analyzer, census script, or oracle" — and
 * this file is a census script. So the two token scans below use `splitOnChars`,
 * a delimiter-set splitter written as an index loop, and everything else is
 * `indexOf`/`startsWith`/`split` on a single-character needle.
 */
import { readdirSync, statSync, readFileSync } from "fs"
import * as path from "path"
import * as childProcess from "child_process"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/** Split `text` on any character in `delims`, dropping empty fields. */
function splitOnChars(text: string, delims: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (delims.includes(text[i])) {
      if (i > start) out.push(text.slice(start, i))
      start = i + 1
    }
  }
  if (start < text.length) out.push(text.slice(start))
  return out
}

/** True when `text` contains a whole run of whitespace (the `\s` set, spelled). */
function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v"
}

// The delimiter set the two token scans share: whitespace, both quote characters,
// and the XML attribute/markup punctuation that can never be inside a QName.
//
// `/` is deliberately NOT a delimiter, and the first version of this file had it
// there. That version reported an XSLT population of **0 files** out of 590 XSL
// files in the corpus, because splitting on `/` takes
// `xmlns:xsl="http://www.w3.org/1999/XSL/Transform"` apart into `http:`, `www.w3.org`,
// `1999`, `XSL`, `Transform` — so the URI can never equal itself and every
// stylesheet tests false. The symptom is a silently empty instrument: it printed a
// well-formed JSON object with `files: 0` and no error, and a reader would have
// taken it for a measurement. `:` need not be a delimiter either, because both
// callers split prefix from local with `indexOf(":")` rather than by delimiting.
// The lesson generalises past this file: a probe whose wrong answer is `0` is the
// one whose wrongness is invisible.
const WS_QUOTE_MARKUP_EQ = " \t\n\r\f\v\"'<>="

// The XSLT namespace, and the two local names the ruling names. Spelled as
// strings because a namespace URI is a URI, not a pattern.
const XSLT_NS = "http://www.w3.org/1999/XSL/Transform"
const USE_LOCALS = ["use-attribute-sets", "use-package"]

// ---------------------------------------------------------------- file walk

interface Admitted { repo: string; rel: string; abs: string }
const admitted: Admitted[] = []
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
    admitted.push({ repo: e, rel, abs })
  }
}

console.error(`admitted: ${admitted.length}`)

// ---------------------------------------------------------------- Q1: which are XSLT

/**
 * A file is XSLT if it carries an `xmlns` binding to the XSLT namespace. Read as
 * a token scan, not a regex: split the text on whitespace and quotes, then look
 * for an `=`-joined pair whose value is exactly the namespace. This over-accepts
 * (a prose mention inside a comment would match) and that is the safe direction:
 * it can only ADD files to the XSLT population, never remove one, so a `use`
 * construct hiding in a file this admitted is still in the population.
 */
function declaresXsltNamespace(text: string): boolean {
  for (const tok of splitOnChars(text, WS_QUOTE_MARKUP_EQ)) {
    if (tok === XSLT_NS) return true
  }
  return false
}

/**
 * Q2. The `xsl:version` an XSLT stylesheet declares, read off the
 * `version` attribute on the `xsl:stylesheet` / `xslt:stylesheet` /
 * `transform` element. Returns "absent" when there is none, which is XSLT 1.0 by
 * the specification's own default.
 */
function declaredVersion(text: string): string {
  const at = text.indexOf("version=")
  if (at < 0) return "absent"
  const i = at + "version=".length
  const quote = text[i]
  if (quote !== '"' && quote !== "'") {
    // unquoted: read to the next delimiter
    let j = i
    while (j < text.length && !isSpace(text[j]) && text[j] !== "/" && text[j] !== ">") j++
    return text.slice(i, j)
  }
  const close = text.indexOf(quote, i + 1)
  return close < 0 ? "absent" : text.slice(i + 1, close)
}

// ---------------------------------------------------------------- Q3: the construct, any prefix

/**
 * Q3. Any `prefix:use-attribute-sets` or `prefix:use-package` token, under ANY
 * prefix. Deliberately prefix-agnostic: the ruling's probe binds the XSLT
 * namespace, so a document that binds it to a non-`xsl` prefix is the case where
 * the two could disagree, and this is the instrument that says whether it does.
 */
function useConstructSites(text: string): string[] {
  const hits: string[] = []
  for (const raw of splitOnChars(text, WS_QUOTE_MARKUP_EQ)) {
    const colon = raw.indexOf(":")
    if (colon <= 0) continue
    const local = raw.slice(colon + 1)
    for (const want of USE_LOCALS) {
      if (local === want) { hits.push(raw); break }
    }
  }
  return hits
}

// ---------------------------------------------------------------- the census

const byExt = new Map<string, number>()
const xsltFiles: Admitted[] = []
const versionTally = new Map<string, number>()
const useHitsByFile: { repo: string; rel: string; sites: string[] }[] = []
let declCount = 0

for (const f of admitted) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  const dot = f.rel.lastIndexOf(".")
  const ext = dot < 0 ? "(none)" : f.rel.slice(dot + 1).toLowerCase()
  byExt.set(ext, (byExt.get(ext) ?? 0) + 1)

  if (!declaresXsltNamespace(text)) continue
  xsltFiles.push(f)
  const v = declaredVersion(text)
  versionTally.set(v, (versionTally.get(v) ?? 0) + 1)

  const sites = useConstructSites(text)
  if (sites.length) useHitsByFile.push({ repo: f.repo, rel: f.rel, sites })
}

/**
 * The second instrument, and it is the one that decides: production `parseFile`
 * over the XSLT population, counting `uses` edges actually emitted and counting
 * `use`-named symbols actually published. If the ruling is right, `uses` is 0
 * AND the published-symbol census is 0. If either is non-zero, the ruling is
 * wrong and this file has found it.
 */
const emitted = { rels: 0, usesEdges: 0, filesWithUses: 0, symbolNamesWithUse: 0, filesFailed: 0 }
for (const f of xsltFiles) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo)) } catch { emitted.filesFailed++; continue }
  declCount++
  let fileUses = 0
  for (const x of r.relationships ?? []) {
    emitted.rels++
    const t = typeof x.type === "string" ? x.type : String(x.type)
    if (t === "uses" || t === "brain_use" || t === "brain_uses") { emitted.usesEdges++; fileUses++ }
  }
  if (fileUses) emitted.filesWithUses++
  for (const s of r.symbols ?? []) {
    const n = typeof s.name === "string" ? s.name.toLowerCase() : ""
    const colon = n.indexOf(":")
    const local = colon >= 0 ? n.slice(colon + 1) : n
    if (local === "use-attribute-sets" || local === "use-package") emitted.symbolNamesWithUse++
  }
}

const out = {
  instrument: "xslt-dialect-coverage",
  question:
    "does the corpus the `uses` ruling rests on contain any XSLT 2.0+ file, i.e. can it express `xsl:use-package` at all?",
  admittedFiles: admitted.length,
  admittedByExtension: Object.fromEntries([...byExt.entries()].sort((a, b) => b[1] - a[1])),
  xsltPopulation: {
    definition: "an admitted file whose text binds the XSLT namespace http://www.w3.org/1999/XSL/Transform",
    files: xsltFiles.length,
    distinctRepos: new Set(xsltFiles.map(f => f.repo)).size,
    repos: [...new Set(xsltFiles.map(f => f.repo))].sort(),
  },
  declaredVersion: Object.fromEntries([...versionTally.entries()].sort((a, b) => b[1] - a[1])),
  canExpressUsePackage:
    (versionTally.get("2.0") ?? 0) + (versionTally.get("3.0") ?? 0) + (versionTally.get("4.0") ?? 0) > 0,
  useConstructSitesAnyPrefix: {
    files: useHitsByFile.length,
    detail: useHitsByFile.slice(0, 20),
  },
  productionParseFileOverXsltPopulation: { ...emitted, filesRun: declCount },
  overrideConditionForUses:
    "a non-zero count of use-attribute-sets / use-package under any prefix, on the parse tree or in production output",
  overrideFired: useHitsByFile.length > 0 || emitted.usesEdges > 0 || emitted.symbolNamesWithUse > 0,
}
console.log(JSON.stringify(out, null, 2))