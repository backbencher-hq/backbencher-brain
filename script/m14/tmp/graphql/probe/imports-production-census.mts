/**
 * `imports` over the PRODUCTION entry point, and against the DISK.
 *
 * ## Why this probe exists when two others already measure `imports`
 *
 * `probe/imports-and-calls.mts` classifies directives off the PARSE TREE with its OWN copy of
 * the `#import` reader, and that copy is STALE: it stops a binding name at whitespace and
 * quotes but not at a comma, so `# import C1, C2 from "c.graphql"` falls through its final
 * `if (word() !== "from") return { form: "unrecognised" }`. Its artifact therefore records
 * `byForm.unrecognised: 12` — twelve directives the SHIPPED analyzer reads correctly, since
 * commit `4ecf80989` put the comma in `word()` in the analyzer. An artifact that under-reports
 * the thing the code does is worse than no artifact, because it looks like evidence.
 *
 * `probe/verify-imports-production.mts` does go through production `parseFile`, but over ONE
 * repository (`gql-graphql-tools`, 240 tracked files) — and that repository alone now accounts
 * for 165 import edges, so it cannot be quoted as the corpus figure.
 *
 * This probe therefore measures the corpus-wide number from the product's own output, and then
 * answers the one question a production walk cannot: `imports` names a FILE, so the only oracle
 * that can judge it is `existsSync`. Two bases are reported because an earlier pass of this lane
 * quoted the wrong one:
 *
 *   - the IMPORTING FILE'S OWN DIRECTORY — what graphql-import-node, graphql-tools and
 *     eslint-plugin-graphql all do, and 91.76% of targets resolve here;
 *   - the REPOSITORY ROOT — what the earlier pass used, and 0 of 170 resolve there.
 *
 * A reader told "0% resolve" would conclude the edges are fabricated when they are 91.76% real.
 * Both numbers are published so the difference is visible rather than resolved by assertion.
 *
 * ## What this probe deliberately does not claim
 *
 * Resolution of an `imports` edge against a SYMBOL set is 0% by construction and that is not a
 * property of the edge: the target names another file, and this analyzer sees one file at a time.
 * So no symbol-set resolution rate is computed here. The disk is the oracle, and the oracle
 * reports what it can.
 *
 * ## Entry point
 *
 * `parseFile` from `src/ast/pool-worker.ts`, not `analyze()`. Population is the arbiter's own
 * admission rule so the denominator is the same set of files the gate walks.
 */
import * as path from "path"
import * as fs from "fs"
import { execFileSync } from "child_process"
import { statSync } from "fs"
import { ROOT } from "../paths.mts"
import { fileURLToPath } from "node:url"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out")

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))

// ───────────────────────────────────────────────────────────── population
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "graphql") continue
    files.push({ repo: e, dir, rel, abs })
  }
}

// ───────────────────────────────────────────────────────────── accumulators
const importEdges: { file: string; source: string; target: string; line: number; meta: any }[] = []
const filesWithImports = new Set<string>()
const byForm = new Map<string, number>()
let otherRelInThoseFiles = 0
let emptyOrUnknownEndpoints = 0
let magicFileLiteralSources = 0
let filesParsed = 0
let parseErrors = 0

/**
 * Symbols in the 131 files that carry an import. It was the literal `0` written into the output
 * as if it were a count — a number with no measurement behind it, in a document whose subject is
 * the cost of not measuring. It is here so a reader can see how much schema surrounds an import
 * edge, and it is computed because that is the only kind of number worth printing.
 */
let symCountInImportFiles = 0

for (const f of files) {
  const content = fs.readFileSync(f.abs, "utf8")
  let res: any
  try {
    res = await parseFile(f.abs, content, { language: "graphql" } as any)
  } catch {
    parseErrors++
    continue
  }
  filesParsed++
  const rels: any[] = res?.relationships ?? []
  const mine = rels.filter((r) => String(r.type).includes("import") || String(r.type).endsWith("import"))
  if (mine.length === 0) continue
  filesWithImports.add(`${f.repo}/${f.rel}`)
  symCountInImportFiles += (res?.symbols ?? []).length
  otherRelInThoseFiles += rels.length - mine.length
  for (const r of mine) {
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    if (src.length === 0 || tgt.length === 0 || src === "unknown" || tgt === "unknown") emptyOrUnknownEndpoints++
    // The magic source this file's `exports` edges use is the literal `(file)`. An `imports`
    // edge carrying it would be unjoinable, so it is counted rather than assumed absent.
    if (src === "(file)") magicFileLiteralSources++
    const form = String(r.metadata?.importForm ?? "unknown")
    byForm.set(form, (byForm.get(form) ?? 0) + 1)
    importEdges.push({ file: `${f.repo}/${f.rel}`, source: src, target: tgt, line: r.line ?? r.lineNumber ?? -1, meta: r.metadata ?? {} })
  }
}

// ───────────────────────────────────────────────────────────── the disk oracle
let existsAtOwnDirectory = 0
let existsAtRepoRoot = 0
let targetIsOutsideRepo = 0
let targetIsNotAPath = 0
let missingAtOwnDirectory = 0
const missingExamples: string[] = []
const notAPathExamples: string[] = []

for (const e of importEdges) {
  const dir = path.join(CR, e.file.split("/")[0])
  const abs = path.join(CR, e.file)
  const t = e.target
  const isUrl = t.includes("://") || (t.startsWith("@") && t.includes("/")) || t.startsWith("require:") || t.startsWith("#")
  if (isUrl) {
    targetIsNotAPath++
    if (notAPathExamples.length < 12) notAPathExamples.push(`${e.file} -> ${t}`)
    continue
  }
  const own = path.resolve(path.dirname(abs), t)
  if (!own.startsWith(path.resolve(dir) + path.sep)) targetIsOutsideRepo++
  else if (fs.existsSync(own)) existsAtOwnDirectory++
  else {
    missingAtOwnDirectory++
    if (missingExamples.length < 12) missingExamples.push(`${e.file} -> ${t}`)
  }
  // the base the earlier pass used, kept so the difference stays visible
  const root = path.resolve(dir, t.replace(/^\.\//, ""))
  if (fs.existsSync(root)) existsAtRepoRoot++
}

const n = importEdges.length
/** Rate over the EDGE population. Denominator is the edge count, always stated with the number. */
const pct = (a: number) => (n === 0 ? null : Number(((100 * a) / n).toFixed(2)))
/**
 * Rate over the FILE population. This was first written as `pct(filesWithImports.size)`, which
 * divides 131 files by 170 EDGES and prints 77.06% for the share of the corpus carrying an
 * import — a number about a denominator the label does not name. A rate is only a fact about the
 * population it names, so this one names the corpus.
 */
const pctOfFiles = (a: number) => (files.length === 0 ? null : Number(((100 * a) / files.length).toFixed(2)))

const out = {
  kind: "m60-graphql-imports-production-census",
  producedBy: "script/m14/tmp/graphql/probe/imports-production-census.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CR,
  population: {
    admittedFiles: files.length,
    filesParsed,
    parseErrors,
    repos: files.length === 0 ? 0 : new Set(files.map((f) => f.repo)).size,
  },
  imports: {
    edges: n,
    distinctFiles: filesWithImports.size,
    pctOfCorpusFiles: pctOfFiles(filesWithImports.size),
    byForm: Object.fromEntries([...byForm.entries()].sort()),
    emptyOrUnknownEndpoints,
    magicFileLiteralSources,
    /** the oracle: an `imports` target is a FILE, so the disk is the only judge */
    targetExistsAtImportingFilesDirectory: existsAtOwnDirectory,
    targetExistsAtImportingFilesDirectory_pct: pct(existsAtOwnDirectory),
    targetExistsAtRepositoryRoot: existsAtRepoRoot,
    targetExistsAtRepositoryRoot_pct: pct(existsAtRepoRoot),
    targetIsNotAPath: targetIsNotAPath,
    targetIsOutsideRepo: targetIsOutsideRepo,
    missingAtOwnDirectory,
    missingExamples,
    notAPathExamples,
    resolutionNote:
      "0% against a symbol SET would be true by construction and is not reported as a rate: the target names another file and this analyzer is a per-file unit. The two bases above are both real; the importing file's own directory is what graphql-import-node, graphql-tools and eslint-plugin-graphql resolve against.",
  },
  context: {
    otherRelationshipsInThoseFiles: otherRelInThoseFiles,
    symCountInImportFiles,
  },
  sample: importEdges.slice(0, 10),
}

fs.writeFileSync(path.join(OUT, "imports-production-census.json"), JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))