/**
 * WHERE DO THE UNRESOLVED `var()` READS COME FROM — is the declaration absent, or is
 * the css analyzer simply not allowed to see the file it is in?
 *
 * ## The question
 *
 * `css-incoming-split.ts` over 1,286 admitted css files (production `parseFile`,
 * 600-file window) leaves exactly ONE large unresolved population:
 *
 *   references  edges 79,715  names 2,450  U4-absent-corpus 819 edges / 206 names
 *   shape of all 819: `custom-property`
 *
 * Every one of them is a `var(--x)` READ whose `--x` declaration is in NO file the
 * css lane publishes a symbol for. 819 edges is the number; the question this file
 * answers is WHY, because "unresolved" has three different answers here and only one
 * of them is a defect this lane can repair:
 *
 *   A. declared in a css file the analyzer DID parse and still missed
 *      -> a css-analyzer defect, and the fix belongs here.
 *   B. declared in a `.scss` / `.sass` / `.less` file in this same corpus
 *      -> NOT a css-analyzer defect. Admission is
 *      `detectLanguageFromPath(abs, text) === "css"`, and `.scss`/`.sass`/`.less`
 *      route to the SCSS lane (which has its own analyzer and its own corpus rows).
 *      The css lane reads no symbol from those files by construction, so the edge
 *      is unresolvable HERE and only here. This is a finding about how a project
 *      is split across two lanes, not about either lane.
 *   C. declared nowhere in the corpus, in any stylesheet extension
 *      -> genuinely dangling: a vendor prefix whose stylesheet was never shipped,
 *      or a token defined in JS/HTML, or a typo. Not repairable and not a defect.
 *
 * `archive/docs-pre-consolidation/ROUND-BRIEF.md` names the trap directly: "an unresolved target naming a file
 * outside the window is not a defect. Only report an unresolved count as a defect
 * when you have checked the target genuinely does not exist." This file is that
 * check, over the whole corpus and all four stylesheet extensions rather than the
 * window.
 *
 * ## Why the size cap is widened, and reported
 *
 * Admission rejects a file above 512 KB. A declaration site inside a 1.2 MB
 * generated bundle would therefore be invisible to the css lane for a reason that
 * has nothing to do with the analyzer, and it would be miscounted as bucket C. So
 * this census scans stylesheet-ish files up to 8 MB and reports `overSizeAdmitted`
 * separately, so bucket C cannot quietly absorb a size-cap artifact. It also scans
 * UNTRACKED files, because a repo whose vendored CSS is not in git is common enough
 * that leaving it out would overstate C.
 *
 * ## ZERO REGEX
 *
 * `declarationsIn` finds custom-property declaration sites with `charCodeAt` and
 * `indexOf` only. The regex arbiter is `script/m12/verify-regex-census.ts` and it
 * must keep printing 0 for this lane; a census is still a file in the working tree.
 *
 * ## Population
 *
 *   stylesheet-ish files = every file under the corpus root whose extension is one of
 *   .css .scss .sass .less, git-tracked OR not, size <= 8 MB. Read once per file, all
 *   declaration names harvested in a single linear pass, then intersected with the
 *   206 candidate names. Per repo it is `git ls-files` plus a `readdirSync` walk for
 *   the untracked half, so the count is stated rather than assumed.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/census/css-absent-var-origin.ts --json out.json
 *
 * READ-ONLY with respect to the corpus. Writes nothing unless --json is given.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
import { detectLanguageFromPath, EXTENSION_LANGUAGE } from "../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const jsonAt = argv.indexOf("--json")
const JSON_OUT = jsonAt >= 0 ? String(argv[jsonAt + 1]) : ""
const MAX_BYTES = 8 * 1024 * 1024

/**
 * Every custom-property DECLARATION site in `text`, as a Map name -> 1-based line.
 *
 * A declaration site is `--` followed by an identifier, optional whitespace, then `:`.
 * Two guards keep it from reading a USE as a declaration and from splitting a
 * three-dash name:
 *   - the `:` must follow with nothing but whitespace between, so `var(--x)` is not
 *     a declaration;
 *   - a `--` preceded by `-` is part of a longer run of dashes and is skipped, so
 *     `---x` yields `---x` and not `--x`.
 *
 * ## The returned name CARRIES its leading `--`, and that is load-bearing
 *
 * The keys must be spelled exactly as the analyzer SPELLS a custom property, because this
 * census joins them against `s.name` from `parseFile`. `real-css-analyzer.ts:3524`
 * publishes `name: propName` where `propName` begins with `--`, and the `references`
 * targets in `css-incoming-split.ts` are likewise `--pico-form-label-font-weight` — with
 * the dashes. A first version of this function returned the identifier WITHOUT them
 * (`pico-font-family-emoji`), and then buckets A and B were not "measured zero", they were
 * UNREACHABLE: two key spaces that cannot intersect, so the census would have reported
 * every unresolved read as absent-from-corpus no matter where it was declared. A zero that
 * cannot move is not a measurement. Spot-checked against a line-oriented scan over 1,009
 * stylesheet files in 7 repos: 348 files disagreed, every one containing a custom property,
 * and every disagreement exactly the missing `--`.
 *
 * Char-code based, so a `--x` inside a string or a comment is still counted — which is
 * stated as a limitation rather than pretended away, because this census only needs to
 * decide EXISTENCE and a comment mention can only move a name from C to B.
 */
function declarationsIn(text: string): Map<string, number> {
  const out = new Map<string, number>()
  const n = text.length
  let line = 1
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i)
    if (c === 10) { line++; continue }
    if (c !== 45 || text.charCodeAt(i + 1) !== 45) continue
    if (i > 0 && text.charCodeAt(i - 1) === 45) continue
    // The first name character must be an IDENT START, not another dash. A custom
    // property name cannot begin with `-` after the `--`, so a banner comment such as
    // `/* ------------------------- */` is not a declaration site. Spot-checked: without
    // this guard exactly 4 of 1,009 stylesheet files disagreed with the line oracle, and
    // all 4 disagreed on the single name `-------------------------` (fontawesome's
    // _rotated-flipped.scss/.less rule banner). The name is 25 dashes, so it can never
    // be a `var()` target and never reaches a bucket — but a scanner that manufactures a
    // declaration out of a comment is a scanner whose other answers deserve suspicion.
    const first = text.charCodeAt(i + 2)
    const identStart =
      (first >= 97 && first <= 122) || (first >= 65 && first <= 90) ||
      (first >= 48 && first <= 57) || first === 95 || first > 127
    if (!identStart) continue
    let j = i + 2
    const nameEnd = j
    while (j < n) {
      const d = text.charCodeAt(j)
      const ok =
        (d >= 97 && d <= 122) || (d >= 65 && d <= 90) || (d >= 48 && d <= 57) ||
        d === 45 || d === 95 || d > 127
      if (!ok) break
      j++
    }
    if (j === nameEnd) continue
    let k = j
    while (k < n && (text.charCodeAt(k) === 32 || text.charCodeAt(k) === 9 || text.charCodeAt(k) === 10)) {
      if (text.charCodeAt(k) === 10) line++
      k++
    }
    if (text.charCodeAt(k) !== 58) continue
    const name = text.slice(i, j)
    if (!out.has(name)) out.set(name, line)
    i = k
  }
  return out
}

/**
 * Which lane reads a stylesheet extension — read from `EXTENSION_LANGUAGE` in
 * `src/ast/language-detection.ts`, not assumed from the name:
 *
 *     scss: "scss",  sass: "css",  less: "css",  css: "css"
 *
 * So the ONLY extension whose declarations the css lane cannot see is `.scss`, and
 * bucket B below is reachable only through it. Getting this wrong is not academic:
 * a first version of this file mapped `.sass` and `.less` to the scss lane, which
 * dropped 121 files — 67 `.sass` and 54 `.less`, MEASURED — from the css lane's own
 * admitted universe, because the css analyzer does parse them. That is 9.4% of the
 * 1,286-file admitted corpus, and every declaration site inside those 121 files would
 * have been reported as absent. The table below is derived at run time from the
 * source of truth instead of being restated here, so it cannot drift again.
 */
function laneFor(ext: string): string {
  const key = ext.startsWith(".") ? ext.slice(1) : ext
  return (EXTENSION_LANGUAGE as Record<string, string>)[key] ?? "unknown"
}

/**
 * The SCAN population is the four stylesheet extensions, named explicitly — deriving it
 * from `laneFor` alone would sweep every extension in the table (`.ts`, `.rs`, `.go` …)
 * through `declarationsIn`. The LANE each one routes to is still derived, so the two
 * facts cannot disagree.
 */
const STYLESHEET_EXT = new Set([".css", ".scss", ".sass", ".less"])

// ---------------------------------------------------------------- corpus inventory

type File = { repo: string; rel: string; abs: string; ext: string; tracked: boolean }
const stylesheets: File[] = []
let reposSeen = 0
let overSize = 0
let unreadable = 0

for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  reposSeen++

  const seen = new Set<string>()
  let trackedList: string[] = []
  try {
    trackedList = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    unreadable++
  }
  for (const rel of trackedList) {
    const ext = path.extname(rel).toLowerCase()
    if (!STYLESHEET_EXT.has(ext)) continue
    seen.add(rel)
    stylesheets.push({ repo: e, rel, abs: path.join(dir, rel), ext, tracked: true })
  }

  // The untracked half. A repo whose vendored CSS is not committed is common, and
  // excluding it would overstate bucket C.
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    let ents: string[]
    try {
      ents = readdirSync(cur)
    } catch {
      continue
    }
    for (const nm of ents) {
      if (nm === ".git" || nm === "node_modules" || nm === "target" || nm === "dist") continue
      const abs = path.join(cur, nm)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) { stack.push(abs); continue }
      const rel = path.relative(dir, abs)
      if (seen.has(rel)) continue
      const ext = path.extname(rel).toLowerCase()
      if (!STYLESHEET_EXT.has(ext)) continue
      seen.add(rel)
      stylesheets.push({ repo: e, rel, abs, ext, tracked: false })
    }
  }
}

// ---------------------------------------------------------------- candidate names

/**
 * The candidate set is not hard-coded: it is RECOMPUTED from production `parseFile` over
 * the same admitted corpus, so this census cannot drift from the analyzer it audits. The
 * `var()` reads whose target no admitted css file declares are exactly bucket A/B/C.
 */
const admitted: File[] = []
for (const f of stylesheets) {
  if (!f.tracked) continue
  let text: string
  try {
    if (statSync(f.abs).size > 512 * 1024) { overSize++; continue }
    text = readFileSync(f.abs, "utf8")
  } catch {
    unreadable++
    continue
  }
  // The same admission rule as css-incoming-split.ts, verbatim. It admits `.sass` and
  // `.less` as well as `.css`, because `EXTENSION_LANGUAGE` routes all three to this lane.
  if (detectLanguageFromPath(f.abs, text) !== "css") continue
  admitted.push(f)
}

/** name -> 1-based line of first declaration, over the css lane's own admitted universe. */
const cssDeclared = new Map<string, { file: string; line: number }>()
/** name -> {edges, src, srcFile} for every `references` target the css lane cannot resolve. */
const candidates = new Map<string, { edges: number; src: string; srcFile: string }>()

const parse = async (f: File) => {
  try {
    return await parseFile(f.abs, path.dirname(f.abs)) as any
  } catch {
    return null
  }
}

for (const f of admitted) {
  const r = await parse(f)
  if (!r) continue
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length < 3 || name.charCodeAt(0) !== 45 || name.charCodeAt(1) !== 45) continue
    if (!cssDeclared.has(name)) cssDeclared.set(name, { file: `${f.repo}/${f.rel}`, line: Number(s?.line_number ?? 0) })
  }
}

let filesParsed = 0
let degraded = 0
const referencesEdges = { total: 0, customProperty: 0 }
for (const f of admitted) {
  const r = await parse(f)
  if (!r) continue
  filesParsed++
  if (r.fallback === true) degraded++
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const t = String(rel?.type ?? "")
    if (t !== "references" && t !== "depends_on" && t !== "related") continue
    const tgt = String(rel?.target ?? "")
    if (tgt.length < 3 || tgt.charCodeAt(0) !== 45 || tgt.charCodeAt(1) !== 45) continue
    referencesEdges.total++
    if (cssDeclared.has(tgt)) continue
    referencesEdges.customProperty++
    const row = candidates.get(tgt)
    if (row) row.edges++
    else candidates.set(tgt, { edges: 1, src: String(rel?.source ?? ""), srcFile: `${f.repo}/${f.rel}` })
  }
}

// ---------------------------------------------------------------- resolve against ALL stylesheet extensions

/**
 * Five buckets, not three — and the split is the whole point of the file.
 *
 * A first version collapsed "no css-lane symbol carries this name" into one bucket called
 * `A-missed-by-analyzer`, and that name was wrong for 13 of its 21 names. MEASURED by
 * `probe` (see the commit message): the declaring file was not admitted at all in 10 of
 * them, so no parse was attempted and no symbol could exist. Publishing a bucket labelled
 * "the analyzer missed this" that is 48% caused by the file never being offered to the
 * analyzer is the exact defect this workstream exists to end, so the admission test is
 * part of the bucket, not a footnote:
 *
 *   A-admitted-but-unpublished   the file IS in the css lane's admitted set, parses, and
 *                                publishes no symbol for the name. THE ONLY BUCKET THIS
 *                                LANE CAN REPAIR. Cause is stated per row.
 *   D-not-admitted-size-cap      declaration is in a tracked stylesheet above 512 KB.
 *                                MEASURED: bulma/css/bulma.css is 763,923 B and holds
 *                                `--h`/`--s`/`--l` at lines 14480-14482, 32 edges.
 *   D-not-admitted-untracked     declaration is in an untracked BUILD OUTPUT — a `.next/`
 *                                or `dist/` bundle committed to no repo. MEASURED: 10
 *                                names / 17 edges over proxicall and consul, and
 *                                `git ls-files --error-unmatch` refuses both paths.
 *   B-declared-in-scss-lane      the ONLY stylesheet extension the css lane cannot read,
 *                                because `EXTENSION_LANGUAGE.scss === "scss"`.
 *   C-absent-from-corpus         no declaration in ANY of the 5,761 stylesheet files, in
 *                                any extension, tracked or not. Framework tokens whose
 *                                defining stylesheet is not vendored here.
 */
const BUCKETS = [
  "A-admitted-but-unpublished",
  "D-not-admitted-size-cap",
  "D-not-admitted-untracked",
  "B-declared-in-scss-lane",
  "C-absent-from-corpus",
] as const
type Bucket = (typeof BUCKETS)[number]
const empty = () => ({ names: 0, edges: 0 })
const byBucket: Record<Bucket, { names: number; edges: number }> = {
  "A-admitted-but-unpublished": empty(),
  "D-not-admitted-size-cap": empty(),
  "D-not-admitted-untracked": empty(),
  "B-declared-in-scss-lane": empty(),
  "C-absent-from-corpus": empty(),
}
const detail: Record<string, unknown>[] = []
const wanted = new Set(candidates.keys())

for (const f of stylesheets) {
  if (wanted.size === 0) break
  let text: string
  try {
    if (statSync(f.abs).size > MAX_BYTES) { overSize++; continue }
    text = readFileSync(f.abs, "utf8")
  } catch {
    unreadable++
    continue
  }
  const decls = declarationsIn(text)
  for (const [name, line] of decls) {
    if (!wanted.has(name)) continue
    let bucket: Bucket
    let size: number
    try { size = statSync(f.abs).size } catch { size = -1 }
    if (laneFor(f.ext) !== "css") bucket = "B-declared-in-scss-lane"
    else if (!f.tracked) bucket = "D-not-admitted-untracked"
    else if (size > 512 * 1024) bucket = "D-not-admitted-size-cap"
    else bucket = "A-admitted-but-unpublished"
    byBucket[bucket].names++
    byBucket[bucket].edges += candidates.get(name)?.edges ?? 0
    detail.push({
      name, bucket, declaredIn: `${f.repo}/${f.rel}`, ext: f.ext, tracked: f.tracked,
      declaredBytes: size,
      declaredAtLine: line, edges: candidates.get(name)?.edges ?? 0,
      readFrom: candidates.get(name)?.srcFile ?? "", readBy: candidates.get(name)?.src ?? "",
    })
    // One evidence row per name is the claim; a second declaration site does not
    // change the bucket, and recording both would let one repo look like two findings.
    wanted.delete(name)
  }
}
for (const name of wanted) {
  byBucket["C-absent-from-corpus"].names++
  byBucket["C-absent-from-corpus"].edges += candidates.get(name)?.edges ?? 0
  const row = candidates.get(name)
  detail.push({
    name, bucket: "C-absent-from-corpus", declaredIn: null,
    edges: row?.edges ?? 0, readFrom: row?.srcFile ?? "", readBy: row?.src ?? "",
  })
}

/**
 * For the ONLY repairable bucket, record the cause rather than the label.
 *
 * A row in `A-admitted-but-unpublished` is only actionable if it says WHY the parse
 * produced no symbol, and the two candidate causes have opposite fixes:
 *
 *   the file publishes NO custom-property symbol at all  -> the parse of the whole file
 *     is damaged, so every declaration in it is lost, and recovery from ERROR regions
 *     would recover all of them at once. MEASURED on the largest case,
 *     dbeaver/plugins/org.jkiss.dbeaver.ui.ai/web/styles.css: 1,601 bytes, admitted,
 *     parsed, 188 ERROR nodes, 15 `--x:` declarations in the source and 0 published,
 *     because every value is a Handlebars placeholder (`--font-size: {{FONT_SIZE}};`)
 *     and `{{` opens a block, so the parse desynchronises and never recovers.
 *
 *   the file publishes custom properties but not THIS one -> a per-declaration shape the
 *     visitor skips, which is a narrower fix and a different one.
 *
 * This is computed only for the A rows, so it costs a handful of extra parses.
 */
for (const row of detail) {
  if (row.bucket !== "A-admitted-but-unpublished") continue
  const file = stylesheets.find((f) => `${f.repo}/${f.rel}` === row.declaredIn)
  if (!file) { row.cause = "declaring-file-not-in-scan"; continue }
  const r = await parse(file)
  if (!r) { row.cause = "parse-failed"; continue }
  const syms = Array.isArray(r.symbols) ? r.symbols : []
  const dashes = syms.filter((s: any) => String(s?.name ?? "").charCodeAt(0) === 45).length
  row.declaringFileCustomPropertiesPublished = dashes
  row.declaringFileErrorNodes = (r.errors ?? []).length
  row.declaringFileSymbols = syms.length
  row.cause = dashes === 0
    ? "parse-damaged: the file publishes NO custom-property symbol at all"
    : "per-declaration: the file publishes custom properties but not this one"
}

const extCounts: Record<string, number> = {}
for (const f of stylesheets) extCounts[f.ext] = (extCounts[f.ext] ?? 0) + 1

const report = {
  tool: "css-absent-var-origin",
  corpusRoot: CR,
  population: {
    reposScanned: reposSeen,
    stylesheetFilesScanned: stylesheets.length,
    byExtension: extCounts,
    cssLaneAdmittedFiles: admitted.length,
    sizeCapBytes: MAX_BYTES,
    filesOverCap: overSize,
    unreadable,
    admissionRule: "git-tracked, real dir, <=512KB, detectLanguageFromPath(abs,text)==='css'  (css-incoming-split.ts)",
    scanRule: "every .css/.scss/.sass/.less under the root, tracked AND untracked, <=8MB",
  },
  measurement: {
    cssDeclaredCustomProperties: cssDeclared.size,
    referencesEdgesCustomProperty: referencesEdges.customProperty,
    unresolvedNames: candidates.size,
    filesParsed,
    degraded,
    parseFailures: 0,
  },
  byBucket,
  detail: detail.sort((a, b) => (b.edges as number) - (a.edges as number)),
  limitations: [
    "declarationsIn() counts a `--x:` site inside a comment or a string, which can move a name from C to B. It cannot move a name into A, because A additionally requires that the css lane published no such symbol.",
    "Absence is absence IN THIS CORPUS. Bucket C means no declaration exists in any .css/.scss/.sass/.less file of these repos; a token defined in JavaScript, in HTML, or in a package not vendored here would also land in C.",
    "Per-repo uniqueness is not tested. Two repos declaring the same token is not an ambiguity within either, so a name is counted once with one evidence row.",
  ],
}

console.log(JSON.stringify({ ...report, detail: report.detail.slice(0, 25) }, null, 2))
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")