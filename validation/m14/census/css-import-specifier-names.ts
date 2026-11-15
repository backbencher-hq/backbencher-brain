/**
 * CSS IMPORT SPECIFIER NAMING — how many of the `imports` U4 targets name a file that
 * EXISTS in the corpus under the basename the module symbol is published with?
 *
 * ## The question
 *
 * `real-css-analyzer.ts` publishes the stylesheet module symbol under the file's LAST PATH
 * SEGMENT (`lastPathSegment`, the reason is at the call site: `a/b/theme.css` is written
 * `theme.css` in every `@import`). The `imports` edge's TARGET, by contrast, is the
 * specifier exactly as written: `styles/layout.css`, `./legacy-boostrap.css`,
 * `http://fonts.googleapis.com/css?family=Lato:400,400i`.
 *
 * So the two ends of one edge are spelled by two different rules and the target half is
 * the one that cannot match anything the analyzer publishes. This file counts how much of
 * the U4 population that actually costs, BEFORE any change, so the change can be judged on
 * a number rather than on a plausible story.
 *
 * ## What counts as recoverable
 *
 * The store binds a relationship TARGET by NAME (`resolveTargetStmt` in
 * `src/ast/parallel-indexer.ts` is `WHERE project_id = ? AND name = ?` with a same-file
 * preference), so "recoverable" means narrower than "the file exists". A target is
 * RECOVERABLE only when BOTH hold:
 *
 *   1. the specifier names a FILE, not a package. A URL (`http:`, `https:`, `//cdn...`)
 *      names nothing in this corpus, and a bare extensionless word (`tailwindcss`,
 *      `tw-animate-css`) is a package name resolved by a package manager or a PostCSS
 *      plugin. Neither may be reduced to its last segment: `tailwindcss` happens to collide
 *      with a real file, so recovering it would produce a resolution to the WRONG thing.
 *      The discriminator used here is a final path segment carrying a stylesheet EXTENSION
 *      (`.css .scss .sass .less`), which is what distinguishes `@import "_variables.less"`
 *      (a sibling file) from `@import "tailwindcss"` (a package) — the two differ only by
 *      that suffix, so a slash test alone misclassifies 12 edges.
 *
 *   2. the basename is UNIQUE across the admitted corpus. This is the store's constraint,
 *      not a stylistic one: recovering `styles/layout.css` to `layout.css` when three repos
 *      hold a `layout.css` binds the edge to an arbitrary winner. Those are counted as
 *      `AMBIGUOUS-BASENAME` and left alone — the ambiguity is the published-name contract's,
 *      not this lane's, and inventing a disambiguator would be the fabrication.
 *
 * The `PACKAGE-PREFIXED` bucket is a fourth case worth naming: `@fontsource-variable/figtree/
 * index.css` carries an extension, but its specifier is a package SUBPATH, so its last
 * segment `index.css` says nothing about which file it names. Package-scoped specifiers
 * (`@`-prefixed first segment) are therefore excluded from recovery for the same reason URLs
 * are.
 *
 * ## Sampling
 *
 * Same admission as every other lane census: git-tracked, real dir, <= 512 KB,
 * `detectLanguageFromPath(abs, text) === "css"`, deterministic stride over concatenated
 * per-repo `git ls-files`. Reads the corpus only.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/census/css-import-specifier-names.ts --json out.json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (flag: string, dflt: number): number => {
  const i = argv.indexOf(flag)
  return i >= 0 ? Number(argv[i + 1]) || dflt : dflt
}
const WINDOW = num("--window", 600)
const jsonAt = argv.indexOf("--json")
const JSON_OUT = jsonAt >= 0 ? String(argv[jsonAt + 1]) : ""

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Per-REPO multiset of admitted css basenames. Per repo, not corpus-wide, and the reason is
 * the store's own lookup: `resolveTargetStmt` in `src/parallel-indexer.ts` is
 * `WHERE project_id = ? AND name = ?`, and one `project_id` is ONE repository checkout. The
 * corpus here is 199 SEPARATE repositories standing in for 199 possible projects, so the
 * uniqueness test that decides whether a recovered name binds to one symbol must be run
 * inside a repo. A corpus-wide count answers a question production never asks, and it is
 * strictly too strict: `layout.css` exists in two unrelated repos here and in neither of
 * them alone would its `imports` target be ambiguous.
 */
const admittedByBasePerRepo = new Map<string, Map<string, string[]>>()
/** repo -> admitted css basenames in it. */
const admittedByRepo = new Map<string, Set<string>>()
const admitted: Array<{ repo: string; abs: string }> = []
let repos = 0
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  try {
    if (!isDir(dir)) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  repos++
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
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
    if (detectLanguageFromPath(abs, text) !== "css") continue
    admitted.push({ repo: dir, abs })
    const base = path.basename(abs)
    let perRepo = admittedByRepo.get(dir)
    if (!perRepo) {
      perRepo = new Set()
      admittedByRepo.set(dir, perRepo)
    }
    perRepo.add(base)
    let table = admittedByBasePerRepo.get(dir)
    if (!table) {
      table = new Map()
      admittedByBasePerRepo.set(dir, table)
    }
    const bucket = table.get(base)
    if (bucket) bucket.push(abs)
    else table.set(base, [abs])
  }
}

/** Distinct basenames across the corpus, and how many repos hold each. */
const baseRepoCount = new Map<string, number>()
for (const perRepo of admittedByRepo.values()) {
  for (const base of perRepo) baseRepoCount.set(base, (baseRepoCount.get(base) ?? 0) + 1)
}

// Deterministic stride, matching css-incoming-split.ts.
const stride = Math.max(1, Math.floor(admitted.length / WINDOW))
const window: Array<{ repo: string; abs: string }> = []
for (let i = 0; i < admitted.length && window.length < WINDOW; i += stride) window.push(admitted[i])

interface Rec {
  target: string
  edges: number
  srcFile: string
  bucket:
    | "relative-recoverable"
    | "relative-absent"
    | "relative-ambiguous-basename"
    | "package-prefixed"
    | "bare-specifier"
    | "url-specifier"
  basename: string
  declsUnderBasename: number
}

/** The stylesheet extensions that make a specifier a FILE rather than a package name. */
const STYLESHEET_EXT = [".css", ".scss", ".sass", ".less"]
const hasStylesheetExt = (segment: string): boolean => {
  const dot = segment.lastIndexOf(".")
  if (dot <= 0) return false
  const ext = segment.slice(dot).toLowerCase()
  for (const e of STYLESHEET_EXT) if (ext === e) return true
  return false
}

const recs = new Map<string, Rec>()
let parsed = 0
let parseFailures = 0
let degraded = 0

for (const { repo, abs: file } of window) {
  let res: Awaited<ReturnType<typeof parseFile>>
  try {
    res = await parseFile(file, "css")
  } catch {
    parseFailures++
    continue
  }
  parsed++
  if (res.degraded) degraded++
  for (const rel of res.relationships ?? []) {
    const label = String(rel.type).toLowerCase()
    if (label !== "imports" && label !== "brain_import") continue
    const target = String(rel.target ?? "")
    let bucket: Rec["bucket"]
    let base = target
    const isUrl = target.startsWith("http:") || target.startsWith("https:") || target.startsWith("//")
    base = target.slice(target.lastIndexOf("/") + 1)
    // The `@`-prefixed first segment is a package SCOPE (`@fontsource-variable/...`), and a
    // scope's subpath is resolved by the package manager, so the last segment names
    // something this corpus's file tree does not contain.
    const isPackageScoped = target.startsWith("@") || target.startsWith("~")
    if (isUrl) {
      bucket = "url-specifier"
    } else if (isPackageScoped) {
      bucket = "package-prefixed"
    } else if (!hasStylesheetExt(base)) {
      bucket = "bare-specifier"
    } else {
      const inRepo = admittedByRepo.get(repo)
      const decls = inRepo?.has(base) ? (admittedByBasePerRepo.get(repo)?.get(base)?.length ?? 0) : 0
      bucket = decls === 1 ? "relative-recoverable" : decls === 0 ? "relative-absent" : "relative-ambiguous-basename"
    }
    const key = `${repo}|${bucket}|${target}`
    const prev = recs.get(key)
    if (prev) prev.edges++
    else
      recs.set(key, {
        target,
        edges: 1,
        srcFile: file,
        bucket,
        basename: base,
        declsUnderBasename:
          admittedByRepo.get(repo)?.has(base) === true
            ? (admittedByBasePerRepo.get(repo)?.get(base)?.length ?? 0)
            : 0,
      })
  }
}

const list = [...recs.values()].sort((a, b) => b.edges - a.edges || a.target.localeCompare(b.target))
const BUCKETS: Rec["bucket"][] = [
  "relative-recoverable",
  "relative-ambiguous-basename",
  "relative-absent",
  "package-prefixed",
  "bare-specifier",
  "url-specifier",
]
const edgesByBucket = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<string, number>
const namesByBucket = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<string, number>
for (const r of list) {
  edgesByBucket[r.bucket] += r.edges
  namesByBucket[r.bucket] += 1
}

const out = {
  tool: "css-import-specifier-names",
  corpusRoot: CR,
  admission: "git-tracked, real dir, <=512KB, detectLanguageFromPath(abs,text)==='css'",
  corpusTotal: admitted.length,
  window: WINDOW,
  windowFiles: window.length,
  sampling: `deterministic stride ${stride} over concatenated per-repo git ls-files`,
  repos: repos.length,
  distinctAdmittedBasenamesCorpus: baseRepoCount.size,
  distinctAdmittedBasenamesInWindowRepos: (() => {
    const s = new Set<string>()
    for (const { repo } of window) for (const b of admittedByRepo.get(repo) ?? []) s.add(b)
    return s.size
  })(),
  parsed,
  parseFailures,
  degraded,
  importEdges: list.reduce((a, r) => a + r.edges, 0),
  edgesByBucket,
  namesByBucket,
  targets: list,
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1))
console.log(JSON.stringify({ ...out, targets: list.length, sample: list.slice(0, 12) }, null, 1))
