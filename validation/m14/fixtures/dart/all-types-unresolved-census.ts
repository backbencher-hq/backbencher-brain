/**
 * WHICH TYPE IS BLOCKED BY WHAT — dart lane, whole corpus.
 *
 * `override-unresolved-causes.ts` answers this for ONE type. This answers it for all ten,
 * because "reach 100% for every relationship type" is ten questions and the answer for
 * `overrides` (`isExternalBase`, an out-of-corpus base) is not the answer for `imports`
 * (a target that is not a symbol at all). A lane that treats them the same way fixes one
 * and hides the other.
 *
 * The classifier mirrors `script/m14/incoming-gate.ts:classifyEdge` exactly, so the totals
 * on the left of each row are the gate's numbers and not a second opinion:
 *
 *     decls = |{ symbols whose name OR qualifiedName === tgt }|
 *     decls === 1  resolved · > 1 ambiguous · === 0 unresolved (or external, if marked)
 *
 * The buckets on the right are the DIAGNOSIS, and for module-shaped targets they include a
 * real resolution attempt rather than a label:
 *
 *   MODULE-URI   the target is `package:x/y.dart:*` or a relative path — never a symbol
 *                name, so no index can resolve it as written. For these the fixture
 *                resolves the URI to a corpus file the way an importer would (relative to
 *                the importing file, or `package:NAME/rest` against the `pubspec.yaml`
 *                that declares NAME) and reports how many name a file this corpus HAS.
 *                That number is what a fix could turn into resolved edges, so it is
 *                measured before anything is rewritten.
 *   OWNER-ABSENT the owner type is not published anywhere in the corpus.
 *   OWNER-PUBLISHED-MEMBER-MISSING  the owner IS published and the member is not — the
 *                one bucket whose fix is always inside the analyzer.
 *   BARE         no owner qualifier at all, so there is no path to any declaration.
 *
 * Run: npx tsx validation/m14/fixtures/dart/all-types-unresolved-census.ts [files] [concurrency]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.argv[2] ?? 33692)
const CONC = Number(process.argv[3] ?? 8)

/** The gate's own recognised external markers, plus dart's. Kept in step by hand because
 *  this file is a diagnostic; the gate remains the authority that decides a verdict. */
const EXTERNAL_KEYS = ["isExternalBase", "isExternal", "isExternalTarget", "external", "externalRef", "isStdlib", "stdlibModule"]

function repos(): string[] {
  const out: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    out.push(dir)
  }
  return out
}

function tracked(dir: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { return [] }
}

const REPOS = repos()
const dartFiles: string[] = []
/** every tracked file in the corpus, whatever its extension — the import-resolution target set */
const trackedPaths = new Set<string>()
/** package name -> package directory, read from the corpus's own pubspec.yaml files */
const packageRoots = new Map<string, string>()
let pubspecs = 0
let unreadablePubspecs = 0
for (const dir of REPOS) {
  const files = tracked(dir)
  for (const rel of files) {
    const abs = path.join(dir, rel)
    trackedPaths.add(abs)
    if (rel.endsWith(".dart")) dartFiles.push(abs)
    if (rel === "pubspec.yaml" || rel.endsWith("/pubspec.yaml")) {
      pubspecs++
      // `git ls-files` lists what git TRACKS, not what is on disk: pb-reference tracks
      // `examples/pubspec.yaml` and the working tree does not have it. The first run of
      // this fixture died on exactly that file, which is the cheap version of this bug —
      // the expensive version is a population count that includes files no reader can
      // open. Counted here rather than skipped, because the count is the finding.
      let src: string
      try { src = readFileSync(abs, "utf8") } catch { unreadablePubspecs++; continue }
      const m = /^name:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/m.exec(src)
      // First pubspec wins: the corpus may vendor the same package twice and the map is a
      // lookup aid for the census, not a resolution rule that has to be exhaustive.
      if (m && !packageRoots.has(m[1])) packageRoots.set(m[1], path.dirname(abs))
    }
  }
}
const files = dartFiles.slice(0, LIMIT)
console.log(`all-types unresolved census — ${files.length} of ${dartFiles.length} corpus .dart files`)
console.log(
  `corpus file inventory: ${trackedPaths.size} tracked files · ${pubspecs} pubspec.yaml ` +
  `(${unreadablePubspecs} tracked but ABSENT from disk) · ${packageRoots.size} distinct package names\n`,
)

const declCount = new Map<string, number>()
const kindsByName = new Map<string, Set<string>>()
/** absolute path -> the Module symbol name that file publishes (one per file, by design) */
const moduleNameOf = new Map<string, string>()
const moduleNameDecls = new Map<string, number>()
const edgesByType = new Map<string, { target: string; marked: boolean; from: string }[]>()
let parsed = 0
let degraded = 0
let failed = 0

let cursor = 0
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (true) {
      const i = cursor++
      if (i >= files.length) return
      let r: any
      try { r = await parseFile(files[i], path.dirname(files[i])) } catch { failed++; continue }
      if (!r) { failed++; continue }
      parsed++
      if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") { degraded++; continue }
      for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
        const n = String(s?.name ?? "")
        if (n) {
          declCount.set(n, (declCount.get(n) ?? 0) + 1)
          const k = String(s?.kind ?? "")
          if (!kindsByName.has(n)) kindsByName.set(n, new Set())
          kindsByName.get(n)!.add(k)
          if (k === "module") {
            moduleNameOf.set(files[i], n)
            moduleNameDecls.set(n, (moduleNameDecls.get(n) ?? 0) + 1)
          }
        }
        const q = String(s?.qualifiedName ?? "")
        if (q && q !== n) {
          declCount.set(q, (declCount.get(q) ?? 0) + 1)
          if (!kindsByName.has(q)) kindsByName.set(q, new Set())
          kindsByName.get(q)!.add(String(s?.kind ?? ""))
        }
      }
      for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
        // Raw label, lowercased. Not the gate's alias map: this file groups by what the
        // analyzer WROTE, so a label the gate cannot map still shows up here instead of
        // vanishing from a diagnostic whose whole job is to show what exists.
        const label = String(rel?.type ?? rel?.relationshipType ?? "").toLowerCase()
        if (!label) continue
        const md = rel?.metadata
        const marked = !!md && typeof md === "object" && EXTERNAL_KEYS.some((k) => (md as any)[k] === true)
        const target = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
        if (!edgesByType.has(label)) edgesByType.set(label, [])
        edgesByType.get(label)!.push({ target, marked, from: files[i] })
      }
    }
  }),
)
console.log(`parsed ${parsed} files (${degraded} degraded, ${failed} failed)\n`)

/** An import site's URI, resolved the way an importer would resolve it. */
function resolveUri(importer: string, uri: string): { file: string | null; how: string } {
  if (uri.startsWith("dart:")) return { file: null, how: "dart: SDK (not in corpus by construction)" }
  if (uri.startsWith("package:")) {
    const rest = uri.slice("package:".length)
    const slash = rest.indexOf("/")
    if (slash <= 0) return { file: null, how: "malformed package uri" }
    const pkg = rest.slice(0, slash)
    const root = packageRoots.get(pkg)
    if (!root) return { file: null, how: `package ${pkg} not vendored in corpus` }
    const p = path.join(root, "lib", rest.slice(slash + 1))
    return { file: trackedPaths.has(p) ? p : null, how: `package:${pkg}` }
  }
  if (/^[a-z][a-z0-9+.-]*:/.test(uri)) return { file: null, how: "other scheme" }
  const p = path.resolve(path.dirname(importer), uri)
  return { file: trackedPaths.has(p) ? p : null, how: "relative" }
}

type Buckets = Map<string, number>
const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
const top = (m: Map<string, number>, n = 12) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

const totals = { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0, markedExternal: 0, markedButResolvable: 0 }
console.log(w("type", 20) + w("edges", 10) + w("resolved", 10) + w("amb", 9) + w("unresol", 10) + "marked-ext")
console.log("-".repeat(70))

for (const [label, edges] of [...edgesByType.entries()].sort((a, b) => b[1].length - a[1].length)) {
  let resolved = 0, ambiguous = 0, unresolved = 0, markedExternal = 0, markedButResolvable = 0
  const buckets: Buckets = new Map()
  const examples = new Map<string, Map<string, number>>()
  // module-URI resolution tally, per type
  const uriHow = new Map<string, number>()
  const uriResolvable = { yes: 0, no: 0 }
  const uriToCorpusFileWithModuleName = { unique: 0, colliding: 0, none: 0 }
  const bump = (b: string, tgt: string) => {
    buckets.set(b, (buckets.get(b) ?? 0) + 1)
    if (!examples.has(b)) examples.set(b, new Map())
    examples.get(b)!.set(tgt, (examples.get(b)!.get(tgt) ?? 0) + 1)
  }

  for (const e of edges) {
    const tgt = e.target
    if (tgt.length === 0) { unresolved++; bump("EMPTY TARGET", "(empty)"); continue }
    const decls = declCount.get(tgt) ?? 0
    if (decls === 1) { resolved++; if (e.marked) markedButResolvable++; continue }
    if (decls > 1) { ambiguous++; continue }
    if (e.marked) markedExternal++
    unresolved++
    // A module-shaped target: `package:x/y.dart:*`, `dart:async:*`, `../a/b.dart`.
    const isModuleShape = /^[A-Za-z0-9_./-]+\.dart(:.*)?$/.test(tgt) || tgt.includes(":*") || tgt.startsWith("dart:")
    if (isModuleShape) {
      const uri = tgt.replace(/:\*$/, "")
      const r = resolveUri(e.from, uri)
      uriHow.set(r.how, (uriHow.get(r.how) ?? 0) + 1)
      if (r.file) {
        uriResolvable.yes++
        const mn = moduleNameOf.get(r.file)
        if (mn === undefined) uriToCorpusFileWithModuleName.none++
        else if ((moduleNameDecls.get(mn) ?? 0) === 1) uriToCorpusFileWithModuleName.unique++
        else uriToCorpusFileWithModuleName.colliding++
      } else {
        uriResolvable.no++
      }
      bump(r.file ? "MODULE-URI -> a corpus file EXISTS" : `MODULE-URI -> outside the corpus (${r.how})`, tgt)
      continue
    }
    const dot = tgt.lastIndexOf(".")
    if (dot <= 0) { bump("BARE (no owner qualifier)", tgt); continue }
    const owner = tgt.slice(0, dot)
    if ((declCount.get(owner) ?? 0) > 0) { bump("OWNER-PUBLISHED-MEMBER-MISSING", tgt); continue }
    const root = owner.split(".")[0]
    if (root !== owner && (declCount.get(root) ?? 0) > 0) { bump("OWNER-CHAIN-PUBLISHED-MEMBER-MISSING", tgt); continue }
    bump(/[:/\s]/.test(owner) ? "OWNER-NOT-AN-IDENTIFIER" : "OWNER-ABSENT (outside the population)", tgt)
  }

  totals.edges += edges.length
  totals.resolved += resolved
  totals.ambiguous += ambiguous
  totals.unresolved += unresolved
  totals.markedExternal += markedExternal
  totals.markedButResolvable += markedButResolvable
  console.log(
    w(label, 20) + w(edges.length, 10) + w(resolved, 10) + w(ambiguous, 9) + w(unresolved, 10) +
    `${markedExternal}${markedButResolvable ? ` (${markedButResolvable} of them DO resolve)` : ""}`,
  )
  for (const [b, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${w(b, 56)}${String(n).padStart(8)}${((n / Math.max(1, unresolved)) * 100).toFixed(1).padStart(8)}%`)
    for (const [t, c] of top(examples.get(b) ?? new Map(), 4)) console.log(`        ${w(t, 70)} ${c}`)
  }
  if (uriResolvable.yes + uriResolvable.no > 0) {
    console.log(`    module URIs naming a corpus file: ${uriResolvable.yes}   naming nothing in the corpus: ${uriResolvable.no}`)
    console.log(`      of the resolvable ones, the target file publishes a module symbol: unique ${uriToCorpusFileWithModuleName.unique}, colliding ${uriToCorpusFileWithModuleName.colliding}, none ${uriToCorpusFileWithModuleName.none}`)
    for (const [k, v] of top(uriHow, 6)) console.log(`        ${w(k, 70)} ${v}`)
  }
  console.log()
}

console.log("-".repeat(70))
console.log(
  w("TOTAL", 20) + w(totals.edges, 10) + w(totals.resolved, 10) + w(totals.ambiguous, 9) + w(totals.unresolved, 10) +
  `${totals.markedExternal} (${totals.markedButResolvable} of them resolve anyway)`,
)
console.log(
  `\nmarkers that are WRONG TODAY: ${totals.markedButResolvable} edge(s) carry an external marker while their\n` +
  `target names exactly one published declaration. An external claim on a resolvable target is not a\n` +
  `declared exception, it is a mislabel — and the gate must count it, which is why it verifies.`,
)
const collisions = [...moduleNameDecls.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
console.log(`\nmodule-name collisions: ${collisions.length} names carry more than one declaration (top shown)`)
for (const [n, c] of collisions.slice(0, 10)) console.log(`  ${String(c).padStart(6)}  ${n}`)
