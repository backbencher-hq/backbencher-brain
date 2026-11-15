/**
 * IMPORTS TARGET CLASSES — cause C of the round brief, measured for this lane.
 *
 * ## THE QUESTION
 *
 * `imports` is the only relationship type this analyzer emits whose target is **not a
 * symbol**. `docs/analyzers/xml.md` has always declared that a design
 * choice and reported the type at 0 % resolution, and §The six questions calls the two
 * rates below 100 % "a declared resolvability class, not dangling edges".
 *
 * A declaration is not a measurement. The census already splits `references` and
 * `extends` targets into `in-document` / `builtin` / `external` / `unresolved` because
 * the analyzer stamps `metadata.resolvable` on those edges. **`imports` edges carry no
 * such marker** — the census reports their whole resolvability block as `<none>` — so a
 * target that names a file present in the corpus and a target that is a 404 are stored
 * and counted identically. That is exactly what the round brief's cause C says to stop:
 * "emit them with an explicit external marker so they are countable and excluded,
 * instead of silently unresolved".
 *
 * So this probe answers, per emitted `imports` edge:
 *
 *   1. WHAT SHAPE IS THE TARGET? A URI with a scheme, an absolute path, a relative path
 *      that names a file on disk, a relative path that names nothing, or a bare fragment.
 *   2. DOES IT NAME A FILE THE CORPUS HOLDS? Resolved against the edge's own directory
 *      and then against the repository root, because `xs:include schemaLocation="b.xsd"`
 *      is written relative to the including document and `DOCTYPE … SYSTEM "d.dtd"` is
 *      not. Both answers are recorded separately, because "the relative path exists" and
 *      "the corpus admits that file as xml" are different claims.
 *   3. IS THE MARKER ALREADY THERE? Counted, so the claim "imports carries no
 *      `resolvable` class" is a count and not an impression.
 *
 * ## WHAT IT CANNOT FIND, STATED UP FRONT
 *
 *   CANNOT say the target SHOULD be a symbol. It says what the target is, which is the
 *        question a resolvability marker has to answer before one can be written honestly.
 *   CANNOT see files the corpus does not hold. A `schemaLocation` naming a file that was
 *        never cloned reads as `relative-missing`, which is a statement about this corpus
 *        and not about the document.
 *   CANNOT judge whether resolving an `imports` target to a file symbol is DESIRABLE. It
 *        is a design decision for the store's identity model; see §8 item 9. This probe
 *        produces the number that decision needs and does not make it.
 *
 * ## SAMPLING
 *
 * The same family-stratified deterministic draw `ontology-census.mts` uses, so the
 * denominator is the one the six-questions table already quotes: repositories in sorted
 * order, each contributing at most `BB_XML_PER_REPO` files in lexicographic path order,
 * up to `BB_XML_SAMPLE`. The draw fingerprint is printed and is the draw's own.
 *
 * ## CLI
 *   npx tsx validation/m14/fixtures/xml/imports-target-classes.mts
 *   BB_XML_SAMPLE=2500 BB_XML_PER_REPO=400 BB_XML_WORKERS=1
 *
 * READ-ONLY. Writes nothing except `imports-target-classes.json` beside this file.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SAMPLE = Number(process.env.BB_XML_SAMPLE ?? 2500)
const PER_REPO = Number(process.env.BB_XML_PER_REPO ?? 400)
const WORKERS = Number(process.env.BB_XML_WORKERS ?? 1)
const HERE = import.meta.dirname
const OUT = path.join(HERE, "imports-target-classes.json")

const { parseFile } = (await import("../../../../src/ast/pool-worker")) as any
const { detectLanguageFromPath } = (await import("../../../../src/ast/language-detection")) as any

// ── corpus discovery: the gate's rule, copied EXACTLY ─────────────────────────
type Row = { repo: string; dir: string; rel: string; abs: string }
const byRepo = new Map<string, Row[]>()
for (const e of readdirSync(CR).sort()) {
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
  const rows: Row[] = []
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try {
      size = statSync(abs).size
    } catch {
      continue
    }
    if (size > 512 * 1024) continue
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    // The language filter belongs in DISCOVERY. Filtering during the draw instead is
    // what the first version did, and its termination condition was "no repo admitted
    // anything this pass" — which is true of any repo whose first tracked path is
    // `README.md`, so it drew 1,027 files from 15 repositories where the census draws
    // 2,500 from 125, and printed nothing about the difference. Here `byRepo` holds only
    // admitted files, so the round-robin has nothing to skip.
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    rows.push({ repo: e, dir, rel, abs })
  }
  if (rows.length > 0) byRepo.set(e, rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
}

// ── the draw: `ontology-census.mts`'s round-robin, copied ───────────────────
// Family-stratified: every repo gets its share before any repo gets a second file,
// so a 4,000-file repository cannot crowd out a 30-file one.
const selected: Row[] = []
{
  const queues = new Map([...byRepo].map(([k, v]) => [k, [...v]]))
  let progress = true
  while (progress && selected.length < SAMPLE) {
    progress = false
    for (const [repo, rows] of queues) {
      if (rows.length === 0 || selected.length >= SAMPLE) continue
      if (selected.filter((f) => f.repo === repo).length >= PER_REPO) continue
      selected.push(rows.shift()!)
      progress = true
    }
  }
  selected.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))
}

// The census's OWN fingerprint formula, so an identical draw prints an identical
// fingerprint and a reader can tell at a glance whether two denominators match.
const fingerprint = (() => {
  const h = createHash("sha256")
  for (const f of selected) {
    let size = -1
    try {
      size = statSync(f.abs).size
    } catch {}
    h.update(`${f.repo}/${f.rel} ${size}\n`)
  }
  return h.digest("hex").slice(0, 16)
})()
console.error(`imports-target-classes: ${selected.length} files drawn, fingerprint ${fingerprint}, ${WORKERS} worker(s)`)
if (selected.length === 0) throw new Error("no files drawn — corpus root wrong?")

/** The admitted set, as absolute paths, so "the corpus admits it as xml" is answerable. */
const admittedAbs = new Set(selected.map((r) => r.abs))

/** A URI with a scheme, per RFC 3986's `scheme ":"`. Deliberately not `isRemoteUri`'s
 *  list — this probe classifies what the TARGET IS, so it must not inherit the
 *  analyzer's idea of which schemes matter. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.\-]*:/

type Class =
  | "remote-uri"          // carries a scheme: http:, https:, ftp:, jar:, classpath: …
  | "absolute-path"       // starts at the filesystem root
  | "relative-file-on-disk"      // resolves, and the file exists
  | "relative-file-admitted"     // …and that file is one the router admits as xml
  | "relative-missing"    // resolves to nothing on disk
  | "fragment-only"       // starts with '#', names no path at all

function classify(target: string, row: Row): { cls: Class; resolved?: string } {
  if (target.startsWith("#")) return { cls: "fragment-only" }
  if (SCHEME.test(target)) return { cls: "remote-uri" }
  if (target.startsWith("/") || /^[A-Za-z]:[\\/]/.test(target)) return { cls: "absolute-path" }
  // Two bases, because XML writes this target relative to two different things and the
  // probe must not pick one and report the other's misses as misses.
  const near = path.resolve(path.dirname(row.abs), target)
  const root = path.resolve(row.dir, target)
  for (const cand of [near, root]) {
    if (existsSync(cand) && statSync(cand).isFile()) {
      return { cls: "relative-file-on-disk", resolved: cand }
    }
  }
  return { cls: "relative-missing" }
}

// ── the walk ─────────────────────────────────────────────────────────────────
type Rec = {
  repo: string
  file: string
  source: string
  target: string
  role: string
  cls: Class
  admittedAsXml: boolean
  hasResolvableMarker: boolean
  /** The class the ANALYZER stamped on the edge, read back off the edge. */
  analyzerClass: string
}
const recs: Rec[] = []
let cursor = 0
let parseErrs = 0
let fallbackFiles = 0
let filesWithErrors = 0

const worker = async (): Promise<void> => {
  for (;;) {
    const i = cursor++
    if (i >= selected.length) return
    const row = selected[i]
    let res: any
    try {
      res = await parseFile(row.abs, row.rel, "xml")
    } catch {
      parseErrs++
      continue
    }
    if (res?.fallback) fallbackFiles++
    if (res?.errors?.length) filesWithErrors++
    for (const rel of res?.relationships ?? []) {
      const type = rel.relationshipType ?? rel.type
      if (type !== "imports") continue
      const target = String(rel.target ?? rel.to ?? "")
      if (!target) continue
      const { cls, resolved } = classify(target, row)
      recs.push({
        repo: row.repo,
        file: row.rel,
        source: String(rel.source ?? rel.from ?? ""),
        target,
        role: String((rel.metadata as any)?.role ?? (rel.metadata as any)?.externalIdKind ?? ""),
        cls: cls === "relative-file-on-disk" && resolved && admittedAbs.has(resolved) ? "relative-file-admitted" : cls,
        admittedAsXml: Boolean(resolved && admittedAbs.has(resolved)),
        hasResolvableMarker: (rel.metadata as any)?.resolvable !== undefined,
        analyzerClass: String((rel.metadata as any)?.resolvable ?? "<none>"),
      })
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, WORKERS) }, () => worker()))

const tally = (xs: Rec[], f: (r: Rec) => string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const r of xs) out[f(r)] = (out[f(r)] ?? 0) + 1
  return out
}
const byClass = tally(recs, (r) => r.cls)
const total = recs.length

const report = {
  generatedBy: "validation/m14/fixtures/xml/imports-target-classes.mts",
  question:
    "what IS an `imports` target, and does the analyzer already mark it? `imports` is the only type this analyzer emits whose target is not a symbol, and it is reported at 0 % resolution.",
  draw: { root: CR, fingerprint, files: selected.length, perRepoCap: PER_REPO, totalCap: SAMPLE, workers: WORKERS, repositories: new Set(recs.map((r) => r.repo)).size },
  integrity: { parseErrs, fallbackFiles, filesWithErrors },
  edges: total,
  distinctTargets: new Set(recs.map((r) => r.target)).size,
  byClass,
  /** The load-bearing row: a target that names a file this very draw admitted. */
  fileAdmittedAsXml: recs.filter((r) => r.admittedAsXml).length,
  hasResolvableMarker: recs.filter((r) => r.hasResolvableMarker).length,
  /** What the analyzer stamped, counted. */
  byAnalyzerClass: tally(recs, (r) => r.analyzerClass),
  /**
   * The cross-tab that decides whether the analyzer's class is honest: the analyzer may
   * not consult the filesystem, so its `file` class cannot claim existence. What it CAN
   * be wrong about is calling a remote URI a path, or a fragment a path. The cells that
   * would be those errors are named.
   */
  analyzerVsCorpus: (() => {
    const agree: Record<string, number> = {}
    const disagree: Record<string, number> = {}
    const detail: Record<string, number> = {}
    for (const r of recs) {
      // The corpus-side truth, coarsened to the analyzer's three classes.
      const truth = r.cls === "remote-uri" ? "external" : r.cls === "fragment-only" ? "in-document" : "file"
      const k = `${r.analyzerClass} vs ${truth}`
      if (r.analyzerClass === truth) agree[truth] = (agree[truth] ?? 0) + 1
      else disagree[k] = (disagree[k] ?? 0) + 1
      detail[k] = (detail[k] ?? 0) + 1
    }
    return { agree, disagree, mismatchedExamples: recs.filter((r) => {
      const truth = r.cls === "remote-uri" ? "external" : r.cls === "fragment-only" ? "in-document" : "file"
      return r.analyzerClass !== truth
    }).slice(0, 8).map((r) => `${r.file}: ${r.target} — analyzer ${r.analyzerClass}, corpus ${r.cls}`) }
  })(),
  /** One worked example per class, because a class with no example cannot be checked. */
  examplesByClass: (Object.keys(byClass) as Class[]).reduce(
    (acc, c) => {
      acc[c] = recs.filter((r) => r.cls === c).slice(0, 3).map((r) => `${r.file}: ${r.source} -imports-> ${r.target}`)
      return acc
    },
    {} as Record<string, string[]>,
  ),
  /** The claim that would have to be false for cause C to be already done. */
  falsifier:
    "if hasResolvableMarker were equal to edges, the marker exists and this probe is obsolete; if fileAdmittedAsXml were 0, a file-shaped marker would describe nothing and `external` would be the only honest class.",
}
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
console.error(`wrote ${OUT}`)
console.log(`draw ${fingerprint}  files ${selected.length}  repos ${report.draw.repositories}  workers ${WORKERS}`)
console.log(`imports edges ${total}  distinct targets ${report.distinctTargets}  with a resolvable marker ${report.hasResolvableMarker}`)
console.log(`targets naming a file this draw admits as xml: ${report.fileAdmittedAsXml}`)
for (const [c, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(24)} ${String(n).padStart(5)}  ${((n / (total || 1)) * 100).toFixed(1)}%`)
  for (const ex of report.examplesByClass[c] ?? []) console.log(`      e.g. ${ex}`)
}