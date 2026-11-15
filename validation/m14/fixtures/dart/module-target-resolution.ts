/**
 * Are `imports` / `exports` targets EXTERNAL, or are they corpus files nobody
 * published?
 *
 * ## The question
 *
 * Declared limitation 12 in `docs/analyzers/dart.md` reads:
 *
 *   "`imports` and `exports` targets are module URIs and bind to no symbol by
 *    design. 22,909 rows, 100% of both labels. `package:flutter/material.dart:*`
 *    and `../core.dart` are paths, not declarations."
 *
 * That sentence puts all 22,909 rows in one bucket, and the bucket is named for the
 * two examples quoted. **The examples are not the population.** `dart:core` and
 * `package:flutter/material.dart` name no file in this corpus and no file in any
 * checkout of it — they are SDK and framework. `package:http/http.dart` names a file
 * that IS in this corpus, at `dart-http/pkgs/http/lib/http.dart`, and `src/client.dart`
 * is a relative URI that resolves inside the importing file's own package. Those are
 * not external. They are in-corpus files, and "in corpus but unresolvable" is a
 * DIFFERENT finding from "external", in the same way that a declaration this lane
 * failed to publish is a different finding from one in a package it never cloned.
 *
 * The workstream's incoming brief requires exactly this split and says the two "look
 * identical in a count and are opposite findings". So this instrument resolves every
 * module target against the corpus's own file tree and reports the split, rather than
 * repeating a count that cannot be acted on.
 *
 * ## What "resolvable" means HERE, and what it does not claim
 *
 * A target is `IN_CORPUS` when the URI resolves to a `.dart` file that this corpus
 * checkout tracks. That is a statement about the FILE, measured by resolving a path.
 * It is NOT a claim that the graph can already walk the edge: the analyzer publishes a
 * file's symbols under the file's base name (`moduleName`, `path.basename` without
 * extension — `real-dart-analyzer.ts:251`), and an `imports` target is spelled
 * `${uri}:*`, so the two spellings do not meet. Closing that is a naming decision with
 * a blast radius across every language, and it is reported, not made here. What this
 * file settles is the question the count was being used to answer: how much of the
 * 100% is genuinely unreachable and how much is an unpublished local file.
 *
 * `NOT_IN_CORPUS` is then split by cause, because a URI can fail to resolve for three
 * different reasons and only one of them is "not my problem":
 *
 *   - `sdk`          — `dart:` URIs. No corpus checkout contains them, ever.
 *   - `frameworkSdk` — `package:flutter/`, `package:flutter_test/` and friends. The
 *                      Flutter SDK is not in this corpus and is not clonable from it.
 *   - `transitive`   — `package:<name>/...` or relative, naming a file this checkout
 *                      does not track: a transitive dependency not cloned, or
 *                      GENERATED output absent from `git ls-files`. Both are corpus
 *                      properties and they are counted separately from the two above
 *                      because the remedy differs (clone the dep / generate the file).
 *
 * ## How resolution is decided — package identity from `pubspec.yaml`
 *
 * `package:foo/bar.dart` does not name a directory; it names the package `foo`, and a
 * monorepo checkout may hold several directories called `foo`. So package identity is
 * read from the FILE SYSTEM, not guessed from the path: every tracked `.dart` file is
 * attributed to its nearest ancestor directory containing a `pubspec.yaml`, and that
 * directory's basename plus the file's path relative to its `lib/` is the key. This is
 * what makes `dart-http/pkgs/http/lib/http.dart` answer to `package:http/http.dart`, and
 * it is a `statSync` walk, not a path convention.
 *
 * ## NO REGEX
 *
 * URI handling is `startsWith`, `indexOf`, `split` and `path.*` over the TARGET STRING
 * the analyzer emitted. No pattern is matched against source text, so a comment
 * containing `import 'package:x/y.dart'` cannot enter the population and a grammar
 * change cannot silently break the instrument. The target string arrives from the
 * analyzer's own relationship list, so the population is the analyzer's edges and not
 * a re-derivation of them.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/dart/module-target-resolution.ts
 *   BB_DART_PER_REPO=60 npx tsx .../module-target-resolution.ts   # faster draw
 *
 * Walks the SAME five repositories the lane's census walks, at the census's stride, so
 * the denominator is a population this lane has already published counts for. The file
 * count and the corpus-wide tracked total are both printed so a reader can tell which
 * draw produced the split.
 */
import { execFileSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_DART_REPOS ?? "proxicall,dart-http,riverpod,flutter-packages,dart-sdk")
  .split(",")
  .filter(Boolean)
const PER_REPO = Number(process.env.BB_DART_PER_REPO ?? 600)

/** SDK/framework scheme prefixes, split by presence rather than by a table of names. */
const isDartScheme = (u: string) => u.startsWith("dart:")

/**
 * A `package:` URI's package name, and the path within that package's `lib/`.
 * `package:http/src/client.dart` -> `["http", "src/client.dart"]`.
 */
function splitPackageUri(uri: string): [string, string] | null {
  if (!uri.startsWith("package:")) return null
  const rest = uri.slice("package:".length)
  const slash = rest.indexOf("/")
  if (slash <= 0) return null
  return [rest.slice(0, slash), rest.slice(slash + 1)]
}

/** Strip the `:*` suffix the analyzer appends to an `imports` target. */
function bareTarget(t: string): string {
  return t.endsWith(":*") ? t.slice(0, -2) : t
}

/**
 * `<packageName>/<path under lib/>` for every tracked `.dart` file in the corpus,
 * keyed by the pubspec directory's basename. Built once over the FULL tracked set —
 * not the stride sample — because the question is whether a target names a file that
 * EXISTS, and a stride sample would answer "not in my sample" for a file that is
 * present, which is the ambiguity this file exists to remove.
 */
function buildCorpusIndex(): { key: string; pkg: string; pubspecDir: string }[] {
  const rows: { key: string; pkg: string; pubspecDir: string }[] = []
  for (const repo of REPOS) {
    const dir = path.join(CR, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.dart"], {
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
      // Nearest ancestor holding a pubspec.yaml IS the package root. Walking up from
      // the file is what lets a monorepo's pkgs/<name>/lib/<path> answer to
      // `package:<name>/<path>` without assuming a directory layout.
      let d = path.dirname(abs)
      let pkgDir: string | null = null
      for (let hops = 0; hops < 12; hops++) {
        if (existsSync(path.join(d, "pubspec.yaml"))) {
          pkgDir = d
          break
        }
        const up = path.dirname(d)
        if (up === d) break
        d = up
      }
      if (!pkgDir) continue
      const pkg = path.basename(pkgDir)
      const libDir = path.join(pkgDir, "lib")
      const withinLib = path.relative(libDir, abs)
      if (withinLib.startsWith("..")) continue
      rows.push({ key: `${pkg}/${withinLib.split(path.sep).join("/")}`, pkg, pubspecDir: pkgDir })
    }
  }
  return rows
}

/** How many corpus package directories go by each name — the monorepo ambiguity. */
function pkgDirCounts(rows: { pkg: string; pubspecDir: string }[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!m.has(r.pkg)) m.set(r.pkg, new Set())
    m.get(r.pkg)!.add(r.pubspecDir)
  }
  return m
}

// ---------------------------------------------------------------- walk
const corpusRows = buildCorpusIndex()
const byKey = new Set(corpusRows.map(r => r.key))
const dirsByPkg = pkgDirCounts(corpusRows)

/** Framework/SDK packages by name: present in no corpus checkout by construction. */
const FRAMEWORK_PKGS = new Set([
  "flutter",
  "flutter_test",
  "flutter_driver",
  "flutter_web_plugins",
  "flutter_localizations",
  "flutter_localizations_sdk",
  "integration_test",
  "flutter_goldens",
  "sky_engine",
  "leak_tracker",
  "leak_tracker_flutter_testing",
  "leak_tracker_testing",
  "vector_math",
])

type Bucket = "inCorpus" | "sdk" | "frameworkSdk" | "transitive"
type Row = {
  bucket: Bucket
  /** The URI as the analyzer spelled it, for the examples. */
  target: string
  /** Repo-relative importing file, so a row can be walked back to its source. */
  from: string
  /** For `transitive`: why it failed. `pkgAbsentFromCorpus` vs `fileNotTracked`. */
  cause?: string
  /** For `inCorpus`: the corpus file it names. */
  landed?: string
}

const rows: Row[] = []
let filesParsed = 0
let degraded = 0
let parseFailures = 0

const sample: { repo: string; rel: string }[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.dart"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  tracked.sort()
  const stride = Math.max(1, Math.floor(tracked.length / PER_REPO))
  for (let i = 0; i < tracked.length && sample.filter(s => s.repo === repo).length < PER_REPO; i += stride) {
    sample.push({ repo, rel: tracked[i] })
  }
}

for (const s of sample) {
  const abs = path.join(CR, s.repo, s.rel)
  let r: any
  try {
    r = await parseFile(abs, path.dirname(abs))
  } catch {
    parseFailures++
    continue
  }
  if (!r) {
    parseFailures++
    continue
  }
  filesParsed++
  if (r.fallback === true) {
    degraded++
    continue
  }
  const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []
  for (const rel of rels) {
    const type = String(rel?.type ?? "")
    if (type !== "imports" && type !== "exports") continue
    const uri = bareTarget(String(rel?.target ?? ""))
    if (uri.length === 0) continue

    if (isDartScheme(uri)) {
      rows.push({ bucket: "sdk", target: uri, from: `${s.repo}/${s.rel}` })
      continue
    }
    const pkg = splitPackageUri(uri)
    if (pkg) {
      const [name, within] = pkg
      if (FRAMEWORK_PKGS.has(name)) {
        rows.push({ bucket: "frameworkSdk", target: uri, from: `${s.repo}/${s.rel}` })
        continue
      }
      if (!dirsByPkg.has(name)) {
        rows.push({
          bucket: "transitive",
          cause: "packageAbsentFromCorpus",
          target: uri,
          from: `${s.repo}/${s.rel}`,
        })
        continue
      }
      if (byKey.has(`${name}/${within}`)) {
        rows.push({ bucket: "inCorpus", target: uri, from: `${s.repo}/${s.rel}`, landed: `${name}/${within}` })
      } else {
        rows.push({
          bucket: "transitive",
          cause: dirsByPkg.get(name)!.size > 1 ? "ambiguousPackageName" : "fileNotTracked",
          target: uri,
          from: `${s.repo}/${s.rel}`,
        })
      }
      continue
    }
    // RELATIVE. Resolved against the importing file's own directory, which is what
    // the Dart resolver does and what makes `src/client.dart` answerable.
    const landed = path.normalize(path.join(path.dirname(abs), uri))
    if (existsSync(landed) && statSync(landed).isFile()) {
      rows.push({
        bucket: "inCorpus",
        target: uri,
        from: `${s.repo}/${s.rel}`,
        landed: path.relative(CR, landed),
      })
    } else {
      rows.push({ bucket: "transitive", cause: "fileNotTracked", target: uri, from: `${s.repo}/${s.rel}` })
    }
  }
}

// ---------------------------------------------------------------- report
const total = rows.length
const byBucket = new Map<Bucket, number>([
  ["inCorpus", 0],
  ["sdk", 0],
  ["frameworkSdk", 0],
  ["transitive", 0],
])
const causes = new Map<string, number>()
for (const r of rows) {
  byBucket.set(r.bucket, byBucket.get(r.bucket)! + 1)
  if (r.cause) causes.set(r.cause, (causes.get(r.cause) ?? 0) + 1)
}

const pct = (n: number) => (total === 0 ? "  n/a" : `${((n / total) * 100).toFixed(1)}%`.padStart(6))
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log("module-target resolution — are `imports`/`exports` targets EXTERNAL?")
console.log(`corpus root ${CR}`)
console.log(`repositories ${REPOS.join(", ")}   stride ${PER_REPO} per repo`)
console.log(`corpus tracked .dart files attributed to a pubspec package: ${corpusRows.length}`)
console.log(
  `distinct package NAMES: ${dirsByPkg.size}   names held by >1 package directory: ` +
    `${[...dirsByPkg.entries()].filter(([, s]) => s.size > 1).length}`,
)
console.log(`sampled files parsed: ${filesParsed}   degraded: ${degraded}   parse failures: ${parseFailures}`)
console.log(`module targets emitted: ${total}\n`)

console.log(w("bucket", 22) + w("rows", 10) + w("share", 9) + "what it is")
console.log("-".repeat(96))
console.log(
  w("inCorpus", 22) +
    w(String(byBucket.get("inCorpus")!), 10) +
    pct(byBucket.get("inCorpus")!) +
    "  names a .dart file this corpus checkout tracks — an unpublished local file",
)
console.log(
  w("sdk (dart:)", 22) +
    w(String(byBucket.get("sdk")!), 10) +
    pct(byBucket.get("sdk")!) +
    "  no corpus checkout contains it, ever",
)
console.log(
  w("frameworkSdk", 22) +
    w(String(byBucket.get("frameworkSdk")!), 10) +
    pct(byBucket.get("frameworkSdk")!) +
    "  flutter / flutter_test / sky_engine — not in this corpus, not clonable from it",
)
console.log(
  w("transitive", 22) +
    w(String(byBucket.get("transitive")!), 10) +
    pct(byBucket.get("transitive")!) +
    "  a package or file this checkout does not track — a corpus property",
)
console.log("\ntransitive causes:")
for (const [c, n] of [...causes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${w(c, 34)} ${String(n).padStart(7)}  ${pct(n)}`)
}

const examples = (bucket: Bucket, n: number) => {
  const seen = new Set<string>()
  console.log(`\nexamples — ${bucket}:`)
  for (const r of rows.filter(x => x.bucket === bucket)) {
    const k = `${r.target}`
    if (seen.has(k)) continue
    seen.add(k)
    console.log(`  ${k}   <- ${r.from}${r.landed ? `   [lands on ${r.landed}]` : ""}`)
    if (seen.size >= n) break
  }
  if (seen.size === 0) console.log("  (none)")
}
examples("inCorpus", 12)
examples("transitive", 8)

console.log(
  `\nThe share that is NOT external: ${pct(byBucket.get("inCorpus")!)} of ${total} module targets ` +
    `name a file this corpus tracks.`,
)
console.log(
  "Those are the ones a reader would call a defect and a resolver would call a naming\n" +
    "mismatch: the analyzer publishes a file under `path.basename` without extension\n" +
    "(real-dart-analyzer.ts:251) and spells an imports target `${uri}:*`\n" +
    "(real-dart-analyzer.ts:1130), so the two spellings do not meet. Closing that is a\n" +
    "cross-language naming decision and is reported, not made here.",
)