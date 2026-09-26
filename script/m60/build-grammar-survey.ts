// script/m60/build-grammar-survey.ts — the UPSTREAM SURVEY: for every tree-sitter
// grammar the product ships, what else is published, and is any of it better?
//
// WHY this file exists. The grammar version of a lane was recorded in FOUR
// unlinked places — a prose `Parser:` line in docs/analyzers/, a `grammar`
// field in script/m14/spec/*-completeness.json, a version buried in a
// validation/m12/corpus-manifest.json prose `note`, and the bytes of
// wasm/*.wasm itself. Nothing asserted they agreed. The measured consequence
// (reviews/ in the M60 series): three lanes — c, cpp, objective-c — carried
// corpus-error claim artifacts measured against a PRE-PATCH wasm while
// verify-corpus-claims.ts H1 stayed green, because H1 compares prose to
// artifact and never looks at the grammar. The defect class is not a stale
// number; it is that no single artifact is authoritative and nothing gates the
// rest against it.
//
// This generator is that authoritative artifact. It is ONLINE (npm registry +
// GitHub API) and it is the only thing permitted to write the registry.
// Everything else — the offline verifier, the docs gate — READS it.
//
// WHAT IT DOES NOT DO. It does not choose a grammar. Upstream health (release
// cadence, archive state, last commit) is SCREENING evidence that shortlists a
// candidate; it is never the acceptance criterion. Acceptance is
// M14.0.F11 (G1 no newly-damaged file, G2 byte-identical s-expression for every
// file clean under both, G3 no lost symbol/qualifier/(label,target) pair),
// exactly the bar tree-sitter-clean v1.2.7 was admitted under and the bar that
// refused tree-sitter-c's first macro-specifier attempt. Research proposes;
// F11 disposes. The registry records `candidates` with a verdict of
// `unmeasured`, never `accepted`, because this file cannot run F11.
//
// THE THREE-SOURCE RULE. The lane universe is the UNION of the three places a
// lane can be declared — src/ast/engine.ts SUPPORTED_LANGUAGES, the
// validation/m12/corpus-manifest.json analyzer rows, and the
// docs/analyzers/real-*-analyzer.md set — and each source's exclusive members
// are recorded as named remainders rather than smoothed away. The lane->grammar
// map is PARSED out of engine.ts, never hand-copied, so it cannot drift from
// the code that loads the wasm.
//
// DETERMINISM. Every network answer is cached under
// validation/m60/grammar-survey.cache.json. Re-running with the cache
// present makes ZERO network calls and produces a byte-identical registry
// except for `generatedAt`, so a reviewer can diff a re-run and see only real
// upstream movement. `--refresh` re-fetches; `--offline` forbids the network
// outright and fails loudly rather than silently degrading.
//
// Usage:
//   bun run script/m60/build-grammar-survey.ts             # cached (default)
//   bun run script/m60/build-grammar-survey.ts --refresh   # re-fetch upstream
//   bun run script/m60/build-grammar-survey.ts --offline   # forbid network
//   bun run script/m60/build-grammar-survey.ts --lane sql  # one lane, for A/B
//
// Writes:
//   validation/m60/grammar-survey.json          the survey
//   validation/m60/grammar-survey.cache.json    raw network cache

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

import {
  ROOT, WASM_DIR, SPEC_DIR, DOCS_DIR, MANIFEST, M12_RESULTS,
  parseEngineLanes, parseWasmChains, parseAliasMap, manifestLanes, docLanes,
  docFileFor, hasF5Lane, hasF1Lane, f10FloorsFor, f10RowsFor,
} from "./grammar-lanes-source"

const OUT = path.join(ROOT, "validation", "m60", "grammar-survey.json")
const CACHE = path.join(ROOT, "validation", "m60", "grammar-survey.cache.json")

const NET_TIMEOUT_MS = 25_000
const argv = process.argv.slice(2)
const REFRESH = argv.includes("--refresh")
const OFFLINE = argv.includes("--offline")
const ONLY = (() => {
  const i = argv.indexOf("--lane")
  return i >= 0 ? argv[i + 1] : null
})()

const VERSION_RE = /\bv?(\d+\.\d+(?:\.\d+)?)\b/

/** Ordered by trust: the machine-readable spec field wins over prose. */
function declaredVersion(lane: string): { version: string | null; sources: Array<{ file: string; field: string; raw: string | null }> } {
  const sources: Array<{ file: string; field: string; raw: string | null }> = []

  const specFiles = readdirSync(SPEC_DIR).filter((f) => f.endsWith(".json"))
  for (const f of specFiles) {
    let j: any
    try {
      j = JSON.parse(readFileSync(path.join(SPEC_DIR, f), "utf8"))
    } catch {
      continue
    }
    const g = j?.grammar
    if (typeof g !== "string") continue
    // Only the lane's OWN completeness file counts; a spec table is not a pin.
    if (!f.startsWith(`${lane}-completeness`)) continue
    sources.push({ file: `script/m14/spec/${f}`, field: "grammar", raw: g })
  }

  const docPath = docFileFor(lane)
  if (existsSync(docPath)) {
    const lines = readFileSync(docPath, "utf8").split("\n")
    const i = lines.findIndex((l) => /^\s*-\s*Parser:/i.test(l))
    if (i >= 0) {
      // The Parser: bullet is a multi-line paragraph; take it to the next bullet.
      const para: string[] = []
      for (let k = i; k < lines.length; k++) {
        if (k > i && /^\s*-\s+\S/.test(lines[k])) break
        para.push(lines[k].trim())
        if (para.join(" ").length > 400) break
      }
      sources.push({ file: path.relative(ROOT, docPath), field: "Parser:", raw: para.join(" ").replace(/\s+/g, " ") })
    } else {
      sources.push({ file: path.relative(ROOT, docPath), field: "Parser:", raw: null })
    }
  }

  // First non-null wins, in the order the sources were pushed (spec before prose).
  for (const s of sources) {
    if (!s.raw) continue
    // A sha256 in the raw text is a stronger identity claim than a version; if
    // both are present the sha is what the artifact gate will use.
    const v = VERSION_RE.exec(s.raw)
    if (v) return { version: v[1], sources }
  }
  return { version: null, sources }
}

function declaredSha256(lane: string): { sha256: string | null; file: string | null } {
  const specFiles = readdirSync(SPEC_DIR).filter((f) => f.startsWith(`${lane}-completeness`) && f.endsWith(".json"))
  for (const f of specFiles) {
    try {
      const j = JSON.parse(readFileSync(path.join(SPEC_DIR, f), "utf8"))
      const m = /sha256\s+([0-9a-f]{64})/.exec(String(j?.grammar ?? ""))
      if (m) return { sha256: m[1], file: `script/m14/spec/${f}` }
    } catch {
      /* a spec file that does not parse is the verifier's problem, not ours */
    }
  }
  return { sha256: null, file: null }
}

// ---------------------------------------------------------------------------
// Shipped artifact: observed from the bytes on disk. Never declared.
// ---------------------------------------------------------------------------

function shipped(chain: string[] | undefined) {
  const primary = chain?.[0]
  if (!primary) return { file: null, present: false, sha256: null, bytes: null, mtime: null, chain: [] }
  // resolveWasmAsset() keys on the basename, and the repo copy lives at wasm/<base>.
  const file = primary.split("/").pop() as string
  const abs = path.join(WASM_DIR, file)
  if (!existsSync(abs)) return { file, present: false, sha256: null, bytes: null, mtime: null, chain }
  const buf = readFileSync(abs)
  const st = statSync(abs)
  return {
    file,
    present: true,
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: st.size,
    mtime: st.mtime.toISOString(),
    chain,
  }
}

// ---------------------------------------------------------------------------
// Evidence blocks. DERIVED, never authored: the registry reads the existing
// artifacts so it cannot become a fourth place that disagrees with them. The
// verifier asserts these derivations still hold at verify time.
// ---------------------------------------------------------------------------

/**
 * Does a claim artifact identify the grammar it measured?
 *
 * The first design of this check compared the artifact's mtime to the wasm's
 * mtime. That was wrong, and measurably so: all 157 files in
 * validation/m12/results/ carry the SAME mtime (a checkout touched the tree),
 * so mtime reports "fresh" for artifacts that describe a grammar the product
 * replaced weeks ago, and would report "stale" for a freshly measured one. mtime
 * is recorded below as `artifactMtime` and explicitly marked
 * non-authoritative; it is not used to decide anything.
 *
 * What actually binds a claim to a grammar is a HASH STAMPED INTO THE ARTIFACT
 * by the measurement script. Surveyed 2026-09-26: of 41 corpus-error artifacts,
 * exactly one (`sql`) names a `wasmArtifact` and it is a FILENAME, not a hash.
 * Zero record the bytes they measured. That is the root cause of the whole
 * defect class this registry exists to close — a claim and a grammar are never
 * bound, so a grammar swap cannot make any gate red.
 *
 * So the honest reading is per-lane: `recordsGrammarSha256` false means the
 * claim is UNBOUND, which is a named remainder for the verifier rather than a
 * silent pass. The remedy is to re-measure through a stamping writer, not to
 * infer freshness from a timestamp.
 */
function m12Evidence(lane: string) {
  const p = path.join(M12_RESULTS, `${lane}-corpus-errors.json`)
  if (!existsSync(p)) return { artifact: null }
  const j = JSON.parse(readFileSync(p, "utf8"))
  const files = j.measuredFiles ?? j.files ?? j.trackedFiles ?? j.testSuiteFiles ?? null
  const errFiles = j.errorFiles ?? null
  const recordedSha = typeof j.grammarSha256 === "string" ? j.grammarSha256 : null
  return {
    artifact: path.relative(ROOT, p),
    // NON-AUTHORITATIVE: a checkout rewrites every mtime in this directory at
    // once (measured: all 157 files shared one mtime on 2026-09-26). Recorded
    // for forensics, never compared.
    artifactMtime: statSync(p).mtime.toISOString(),
    artifactMtimeIsAuthoritative: false,
    corpus: j.corpusRepo ?? path.basename(String(j.corpus ?? "")),
    revision: (j.revision ?? "").slice(0, 12) || null,
    mode: j.mode ?? null,
    measuredFiles: files,
    errorFiles: errFiles,
    errorRatePct: files && errFiles != null ? Number(((100 * errFiles) / files).toFixed(2)) : null,
    truthSource: j.truthSource ?? null,
    // The binding itself.
    grammarSha256: recordedSha,
    recordsGrammarSha256: recordedSha != null,
    namesWasmFileOnly: typeof j.wasmArtifact === "string" ? j.wasmArtifact : null,
    bindsGrammar: recordedSha != null,
  }
}

function cmpSemver(a: string | null, b: string | null): "behind" | "current" | "ahead" | "unknown" {
  if (!a || !b) return "unknown"
  const pa = a.split(".").map((x) => parseInt(x, 10))
  const pb = b.split(".").map((x) => parseInt(x, 10))
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return "unknown"
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return "ahead"
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return "behind"
  }
  return "current"
}

// ---------------------------------------------------------------------------
// Network. Cached per key; --offline forbids it outright rather than degrading
// to a partial answer.
// ---------------------------------------------------------------------------

type Cache = Record<string, unknown>
const cache: Cache = existsSync(CACHE) && !REFRESH ? JSON.parse(readFileSync(CACHE, "utf8")) : {}
let networkCalls = 0

/** Progress goes to stderr; stdout carries only the summary. A 49-lane refresh
 *  is ~470 sequential calls, so a silent run is indistinguishable from a hung
 *  one — and two were lost to exactly that confusion before this was added. */
function trace(msg: string): void {
  process.stderr.write(`  [${String(networkCalls).padStart(3)}] ${msg}\n`)
}

function cached<T>(key: string, fn: () => T): T {
  if (key in cache) return cache[key] as T
  if (OFFLINE) throw new Error(`build-grammar-survey: --offline but cache lacks ${key}; run without --offline once`)
  networkCalls++
  trace(key)
  const v = fn()
  cache[key] = v
  return v
}

function npmView(pkg: string): any {
  return cached(`npm:${pkg}`, () => {
    try {
      return JSON.parse(execFileSync("npm", ["view", pkg, "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: NET_TIMEOUT_MS }))
    } catch {
      return null
    }
  })
}

function npmSearch(q: string): any[] {
  return cached(`npmsearch:${q}`, () => {
    try {
      return JSON.parse(
        execFileSync("npm", ["search", q, "--json", "--searchlimit", "40"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: NET_TIMEOUT_MS }),
      )
    } catch {
      return []
    }
  })
}

function ghRepo(slug: string): any {
  return cached(`gh:repo:${slug}`, () => {
    try {
      return JSON.parse(
        execFileSync(
          "gh",
          ["api", `repos/${slug}`, "--jq", "{full_name,archived,disabled,stargazers_count,open_issues_count,default_branch,pushed_at,updated_at,fork,parent:.parent.full_name}"],
          { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: NET_TIMEOUT_MS },
        ),
      )
    } catch {
      return null
    }
  })
}

function ghLatestRelease(slug: string): any {
  return cached(`gh:rel:${slug}`, () => {
    try {
      return JSON.parse(
        execFileSync("gh", ["api", `repos/${slug}/releases/latest`, "--jq", "{tag_name,published_at,name}"], {
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          timeout: NET_TIMEOUT_MS,
        }),
      )
    } catch {
      return null
    }
  })
}

function ghTags(slug: string): string[] {
  return cached(`gh:tags:${slug}`, () => {
    try {
      const out = execFileSync("gh", ["api", `repos/${slug}/tags?per_page=100`, "--jq", ".[].name"], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: NET_TIMEOUT_MS,
      })
      return out.split("\n").map((s) => s.trim()).filter(Boolean)
    } catch {
      return []
    }
  })
}

function normalizeRepo(url: string | undefined | null): string | null {
  if (!url) return null
  const m = /github\.com[:/]+([^/]+\/[^/.]+)/.exec(url)
  return m ? m[1].replace(/\.git$/, "") : null
}

function upstreamHealth(pkg: string | null) {
  if (!pkg) return { package: null, available: false, reason: "no npm package recorded for this lane" }
  const v = npmView(pkg)
  if (!v) return { package: pkg, available: false, reason: "npm view failed (not published, or network refused)" }
  const time = v.time ?? {}
  const versions = Object.keys(time).filter((x) => x !== "created" && x !== "modified")
  const latest = v["dist-tags"]?.latest ?? null
  const repo = normalizeRepo(v.repository?.url ?? v.repository) ?? null
  const health = repo ? ghRepo(repo) : null
  return {
    package: pkg,
    available: true,
    latestVersion: latest,
    latestPublished: latest ? (time[latest] ?? null) : null,
    versionCount: versions.length,
    lastPublish: versions.length ? time[versions[versions.length - 1]]?.slice(0, 10) ?? null : null,
    firstPublish: versions.length ? time[versions[0]]?.slice(0, 10) ?? null : null,
    repo,
    repoUrl: v.repository?.url ?? v.homepage ?? null,
    deprecated: v.deprecated ?? null,
    description: v.description ?? null,
    license: v.license ?? null,
    versionTimeline: versions.slice(-12).map((x) => ({ version: x, published: (time[x] ?? "").slice(0, 10) })),
    repoHealth: health,
    // A fork is recorded explicitly rather than merged into the parent:
    // @vokturz/tree-sitter-sql resolving to derekstride/tree-sitter-sql is a
    // provenance fact the reviewer needs, not a dedupe to perform silently.
    isFork: health?.fork ?? null,
    forkParent: health?.parent ?? null,
    latestRelease: repo ? ghLatestRelease(repo) : null,
    recentTags: repo ? ghTags(repo).slice(0, 12) : [],
  }
}

/**
 * A candidate must be a tree-sitter grammar FOR THIS LANE, judged on the
 * package name in two independent parts:
 *
 *   1. the name must actually be a grammar name — after any npm scope it must
 *      begin `tree-sitter-`. Testing only the suffix let every scoped package
 *      through: `@lezer/cpp` reduced to "cpp" and matched lane `cpp`, and bare
 *      `yaml` / `sass` / `toml` / `protobuf` matched their lanes outright.
 *   2. the remainder must be this lane, or a DIALECT of it.
 *
 * (2) uses an EXPLICIT list, not a prefix test. A prefix test was tried and is
 * wrong in a way that matters: `tree-sitter-c-sharp` satisfies
 * `startsWith("c-")` and was admitted as a candidate swap for the C lane — not
 * a dialect of C but a different language. A heuristic that quietly offers the
 * wrong language is worse than no heuristic, so the dialect set is declared
 * where a reviewer can see and correct it.
 *
 * Anything the test rejects lands in `rejectedSearchHits` with its name, so a
 * genuine grammar published under an unexpected name stays visible.
 */
const DIALECT_SUFFIXES: Record<string, string[]> = {
  // `sql-bigquery` and `sql-polyglot` parse the same language as `sql` in a
  // restricted dialect — a legitimate alternative for a lane whose corpus is
  // dialect-specific.
  sql: ["sql-bigquery", "sql-polyglot"],
}

function isGrammarForLane(pkg: string, lane: string): boolean {
  const base = pkg.includes("/") ? pkg.slice(pkg.indexOf("/") + 1) : pkg
  if (!base.startsWith("tree-sitter-")) return false
  const stem = base.slice("tree-sitter-".length).toLowerCase()
  if (!stem) return false
  const want = lane.replace(/^tree-sitter-/, "").toLowerCase()
  if (stem === want) return true
  return (DIALECT_SUFFIXES[want] ?? []).includes(stem)
}

function discoverCandidates(lane: string, ownPkg: string | null, ownRepo: string | null) {
  const seen = new Map<string, any>()
  const rejectedSearchHits: string[] = []
  const add = (pkg: string | null, repo: string | null, via: string) => {
    if (!pkg && !repo) return
    const key = repo ?? pkg!
    if (seen.has(key)) {
      seen.get(key).foundVia.push(via)
      return
    }
    seen.set(key, { package: pkg, repo, foundVia: [via] })
  }
  add(ownPkg, ownRepo, "own-artifact-identity")
  // npm's search endpoint is a fuzzy relevance ranking, not a name index: a
  // "tree-sitter sql" query returns @lezer/java, @lezer/rust, tree-sitter-python
  // and tree-sitter-go alongside the real SQL grammars. The exact-name test
  // above is what keeps that out of the candidate table.
  for (const hit of npmSearch(`tree-sitter ${lane}`)) {
    if (!hit?.name) continue
    if (!isGrammarForLane(hit.name, lane)) {
      rejectedSearchHits.push(hit.name)
      continue
    }
    add(hit.name, null, "npm-search")
  }
  return { candidates: [...seen.values()], rejectedSearchHits }
}

// ---------------------------------------------------------------------------
// Lane universe. Every parse comes from ./grammar-lanes-source so this
// generator and script/m60/verify-grammar-consistency.ts cannot read the same
// declaration sites differently — the one thing a consistency contract must not
// be able to do to itself.
// ---------------------------------------------------------------------------

const engineLanes = parseEngineLanes()
const wasmChains = parseWasmChains()
const aliasOf = parseAliasMap()
const manLanes = manifestLanes()
const docLanesList = docLanes()
const allLanes = [...new Set([...Object.keys(engineLanes), ...manLanes, ...docLanesList])].sort()
const target = ONLY ? allLanes.filter((l) => l === ONLY) : allLanes
if (ONLY && target.length === 0) throw new Error(`build-grammar-survey: no such lane ${ONLY}`)

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const rows: any[] = []
for (const lane of target) {
  const asset = engineLanes[lane] ?? null
  const declared = declaredVersion(lane)
  const sha = declaredSha256(lane)
  const isGeneric = asset === "__generic__"
  const isAlias = lane in aliasOf
  const art = asset && !isGeneric ? shipped(wasmChains[lane]) : { file: null, present: false, sha256: null, bytes: null, mtime: null, chain: [] }
  const m12 = m12Evidence(lane)

  // The package identity comes from the declared prose. The SPEC only wins if it
  // names a version, because only that lane has ever recorded a machine-readable
  // one. The file suffix and markdown backticks are stripped: the doc line reads
  // "`tree-sitter-cpp` **0.23.4**" and the engine chain reads
  // "tree-sitter-cpp/tree-sitter-cpp.wasm", so a naive capture yields
  // `tree-sitter-cpp.wasm`, which is not an npm package — that mistake alone
  // left 22 lanes "unresolved" in the first run.
  const joined = declared.sources.map((s) => s.raw ?? "").join(" ")
  const pkgMatch = /(@?[a-z0-9][a-z0-9._-]*\/)?tree-sitter-[a-z0-9._+-]+/i.exec(joined)
  const ownPkg = pkgMatch ? pkgMatch[0].replace(/`/g, "").replace(/\.(wasm|js|mjs|cjs|json|so|dylib|txt|md)$/i, "") : null
  const ownRepo = /github\.com[:/]+([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)/.exec(joined)?.[1] ?? null

  const health =
    isGeneric || isAlias
      ? {
          package: null,
          available: false,
          reason: isGeneric
            ? "lane is served by GenericAnalyzer and has no grammar"
            : `lane is an alias of ${aliasOf[lane]}; it shares that lane's grammar and its row`,
        }
      : upstreamHealth(ownPkg)

  // No discovery for a lane that has no grammar of its own: a __generic__ lane
  // is served by GenericAnalyzer, and an alias is served by its primary.
  // Surveying them produced `scss -> tree-sitter-scss@1.0.0` as a "candidate
  // swap" for a lane the product does not parse with that grammar at all.
  const discovery =
    isGeneric || isAlias ? { candidates: [], rejectedSearchHits: [] as string[] } : discoverCandidates(lane, ownPkg, ownRepo)
  const candidates = discovery.candidates.map((c) => ({
    ...c,
    upstream: upstreamHealth(c.package ?? null),
    // A candidate is NEVER accepted here. Only F11 can set that, in a review
    // document, and C6 in verify-grammar-consistency.ts checks the document exists.
    verdict: "unmeasured",
    verdictRuling: null as string | null,
    // The RECOVERY SCREEN, named but not run. Upstream health only shortlists; the
    // screen is what makes the shortlist predictive. It exists because the sql
    // adjudication found that for a grammar already failing on most of its corpus,
    // error recovery IS the product, and that no gate measures it: the refused
    // @l1xnan 0.4.7 IMPROVED sites (2504->2271) and MISSING (19->17) on one corpus
    // while destroying 84 symbols and 150 relationships, which no count can tell
    // apart from a win. `recovery` is filled in by the adjudication, never here —
    // this generator does not build grammars, so it cannot measure one.
    screening: {
      instrument: "script/m60/measure-grammar-recovery.ts",
      command: `bun run script/m60/measure-grammar-recovery.ts --lang ${lane} --candidate <built-candidate.wasm>`,
      requires: "a candidate wasm built from the candidate's source (npm package, then `tree-sitter build --wasm`)",
      recovery: null as null | { filesLosingMaterialStructure: number; files: number; medianFileDeltaPct: number | null; aggregateNamedNodesDeltaPct: number | null; errorsDeltaPct: number | null },
    },
  }))

  const f10Rows = f10RowsFor(lane)

  const declaredV = declared.version
  const latestV = health.available ? (health as any).latestVersion : null
  const behind = cmpSemver(latestV, declaredV)

  // A lane is only interesting if some OTHER grammar for it is ahead of what we
  // ship. Deliberately separate from `behind`: a lane can be perfectly current
  // on its own upstream and still have a better-maintained grammar elsewhere.
  // `sql` is exactly that case — @derekstride 0.3.11 IS its own latest, and
  // @l1xnan 0.4.7 published eight months later is the candidate that matters.
  //
  // A lane with NO declared version is excluded here rather than treated as
  // "ahead": "ahead of what?" is unanswerable without a baseline, and counting it
  // put every unrecorded lane in the swap shortlist and buried the real one.
  const aheadCandidates =
    declaredV == null
      ? []
      : candidates
          .filter((c) => cmpSemver(c.upstream?.latestVersion ?? null, declaredV) === "ahead")
          .map((c) => ({
            package: c.package,
            version: c.upstream.latestVersion,
            published: (c.upstream.latestPublished ?? "").slice(0, 10) || null,
            repo: c.upstream.repo,
            archived: c.upstream.repoHealth?.archived ?? null,
            pushedAt: c.upstream.repoHealth?.pushed_at?.slice(0, 10) ?? null,
            stars: c.upstream.repoHealth?.stargazers_count ?? null,
            isFork: c.upstream.isFork ?? null,
            verdict: c.verdict,
          }))
          .sort((a, b) => String(b.published).localeCompare(String(a.published)))

  rows.push({
    lane,
    engineAsset: asset,
    wasmChain: wasmChains[lane] ?? [],
    generic: isGeneric,
    aliasOf: isAlias ? aliasOf[lane] : null,
    inSources: {
      engine: lane in engineLanes,
      manifest: manLanes.includes(lane),
      doc: existsSync(docFileFor(lane)),
    },
    declared: {
      version: declaredV,
      versionKnown: declaredV != null,
      sha256: sha.sha256,
      sha256File: sha.file,
      sources: declared.sources,
    },
    shipped: art,
    upstream: health,
    candidates,
    rejectedSearchHits: discovery.rejectedSearchHits,
    staleness: {
      behind,
      aheadCandidates,
      hasAheadCandidate: aheadCandidates.length > 0,
      note:
        declaredV == null
          ? "NO DECLARED VERSION — staleness cannot be computed and is not assumed to be 'current'"
          : behind === "unknown"
            ? "declared version is not comparable to upstream latest (pre-release, or upstream latest missing)"
            : "compare declared version to upstream latestVersion, and the timeline to lastPublish",
    },
    evidence: {
      m12,
      f10: { rows: f10Rows },
      f10Floors: f10FloorsFor(lane),
    },
    guard: {
      f5DifferentialLane: hasF5Lane(lane),
      f10ParseSuccessFloor: f10Rows.length > 0,
      f1GrammarAudit: hasF1Lane(lane),
    },
    source: {
      vendored: vendoredFor(lane),
      rebuildable: vendoredFor(lane) != null,
    },
  })

  // Flush the network cache after EVERY lane. A full 49-lane refresh is ~470
  // sequential npm/GitHub calls and takes 15+ minutes; the first version of this
  // script wrote the cache only at the end, so a timeout discarded the whole run
  // and the next attempt restarted from zero. Two attempts were lost to that
  // before the flush moved here. A partial cache is still a valid cache: every
  // entry is a complete, keyed answer.
  if (!OFFLINE) {
    mkdirSync(path.dirname(CACHE), { recursive: true })
    writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n")
  }
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const engineOnly = allLanes.filter((l) => l in engineLanes && !manLanes.includes(l))
const manifestOnly = allLanes.filter((l) => manLanes.includes(l) && !(l in engineLanes))
const noDoc = allLanes.filter((l) => !existsSync(docFileFor(l)))
const versionUnknown = rows.filter((r) => !r.declared.versionKnown).map((r) => r.lane)
const unboundClaims = rows.filter((r) => r.evidence.m12.artifact && r.evidence.m12.bindsGrammar === false).map((r) => r.lane)
const misboundClaims = rows
  .filter((r) => r.evidence.m12.grammarSha256 && r.shipped.sha256 && r.evidence.m12.grammarSha256 !== r.shipped.sha256)
  .map((r) => r.lane)
const shaMismatch = rows.filter((r) => r.declared.sha256 && r.shipped.sha256 && r.declared.sha256 !== r.shipped.sha256).map((r) => r.lane)
const noGuard = rows.filter((r) => !r.guard.f5DifferentialLane && !r.guard.f10ParseSuccessFloor).map((r) => r.lane)
const notRebuildable = rows.filter((r) => r.shipped.present && !r.source.rebuildable).map((r) => r.lane)

function vendoredFor(lane: string): string | null {
  const g = path.join(ROOT, "grammars")
  if (!existsSync(g)) return null
  for (const d of readdirSync(g)) if (d === `tree-sitter-${assetFor(lane)}`) return path.relative(ROOT, path.join(g, d))
  return null
}
function assetFor(lane: string): string {
  return (engineLanes[lane] ?? `tree-sitter-${lane}`).replace(/^tree-sitter-/, "")
}

const registry = {
  schemaVersion: 1,
  artifact: "grammar-survey",
  milestone: "M60",
  generatedAt: new Date().toISOString(),
  generator: "script/m60/build-grammar-survey.ts",
  generatorMode: OFFLINE ? "offline-cache-only" : REFRESH ? "refresh" : "cached-or-fetch",
  networkCalls,
  role: "OBSERVATION, not a contract. The pin contract is validation/m14/grammar-pins.json, which owns bytes, surface and provenance; this file owns the UPSTREAM LANDSCAPE and is expected to change whenever anybody publishes a release.",
  ownership: {
    pinIdentity: "validation/m14/grammar-pins.json — owns the wired bytes, the grammar's enumerable surface, vendored source hashes, the source-wasm proof and the authored provenance. Gated for truth by script/m14/verify-grammar-pins.ts. This file must never restate a pin.",
    upstreamSurvey: "this file — owns which grammars are published for each lane, their release cadence and archive state, the candidate shortlist, and the damage/guard status derived from validation/m12 + validation/m14.",
    crossCheck: "script/m60/verify-grammar-consistency.ts — owns NO fact; it proves the two above agree with each other and that the prose sites agree with whichever one owns the lane.",
    rule: "one fact, one owner. Two files with disjoint responsibilities and an enforced cross-check is not drift. Two files both claiming to be the version record is.",
  },
  purpose:
    "For every tree-sitter grammar this product ships: what else is published for that language, how actively it is maintained, and which of those is worth adjudicating through M14.0.F11. The damage and guard columns are DERIVED from validation/m12 and validation/m14 rather than authored here.",
  acceptanceRule: {
    principle: "Research proposes; F11 disposes.",
    screeningSignals: ["release cadence", "last commit", "archive state", "issue activity", "npm publish dates"],
    screeningIsNotAcceptance:
      "Upstream health only shortlists a candidate. A candidate is admissible ONLY through M14.0.F11 — G1 no newly-damaged file, G2 byte-identical s-expression for every file clean under both grammars, G3 no lost symbol/qualifier/(label,target) pair — recorded in a per-lane review document. This generator cannot write any verdict other than `unmeasured`.",
    precedent: "reviews/m60-clean-grammar-127-adjudication.md",
  },
  runtime: runtimeBlock(),
  laneUniverse: {
    rule: "the UNION of three declaration sites, each parsed from its own file; exclusive members are named, never smoothed",
    engineLanes: Object.keys(engineLanes).length,
    manifestAnalyzers: manLanes.length,
    analyzerDocs: docLanesList.length,
    union: allLanes.length,
    engineOnlyAliasLanes: engineOnly,
    manifestOnly,
    lanesWithoutAnalyzerDoc: noDoc,
  },
  counts: {
    lanes: rows.length,
    declaredVersionUnknown: versionUnknown.length,
    claimArtifactNotBoundToGrammar: unboundClaims.length,
    claimArtifactGrammarHashMismatch: misboundClaims.length,
    declaredSha256Mismatch: shaMismatch.length,
    noF5OrF10Guard: noGuard.length,
    notRebuildableFromRepo: notRebuildable.length,
  },
  findings: {
    declaredVersionUnknown: versionUnknown,
    claimArtifactNotBoundToGrammar: unboundClaims,
    claimArtifactGrammarHashMismatch: misboundClaims,
    declaredSha256Mismatch: shaMismatch,
    noF5OrF10Guard: noGuard,
    notRebuildableFromRepo: notRebuildable,
  },
  rows,
  limitations: [
    "This registry records IDENTITY, PROVENANCE and UPSTREAM STATE. It does not measure parse quality; that is validation/m12/results/*-corpus-errors.json and validation/m14/results/M14.0.F10.json, and the `evidence` block here is DERIVED from those files rather than authored beside them.",
    "A declared version is a PROSE CLAIM. Where no version is declared the lane is recorded as `versionKnown: false` and its staleness as `unknown` — never defaulted to `current`.",
    "`staleness.behind` is a semver comparison against upstream's latest tag, not a capability judgement. A grammar can be the newest release and still be the weakest parser for a language.",
    "Candidate discovery searches the npm registry and resolves identity by REPOSITORY, not by package name: `tree-sitter-sql` on npm is a 2021 stub at 0.1.0 with no repository, and a name-keyed upgrade would silently install it.",
    "A candidate listed here is not endorsed. `verdict` is `unmeasured` for every candidate in this file by construction.",
    "The lane->grammar map is parsed out of src/ast/engine.ts, so it cannot drift from the loader. The npm/repo identity is still prose-derived and is the weakest field in the row.",
  ],
}

function runtimeBlock() {
  const wtsPkg = path.join(ROOT, "node_modules", "web-tree-sitter", "package.json")
  const pinned = existsSync(wtsPkg) ? JSON.parse(readFileSync(wtsPkg, "utf8")).version : null
  let cli: string | null = null
  try {
    cli = execFileSync("tree-sitter", ["--version"], { encoding: "utf8" }).trim().split(/\s+/).pop() ?? null
  } catch {
    cli = null
  }
  return {
    webTreeSitter: {
      pinned,
      latest: OFFLINE ? cached("npm:web-tree-sitter:dist-tags", () => null) : null,
      note:
        "MEASURED 2026-09-26 (phase A): moving this pin to 0.27.0 breaks 20 of 55 shipped grammar wasms — every core web language among them (javascript, typescript, tsx, java, go, html, json, ruby, swift, zig, vue). The cause is NOT an API break: 0.27.0 calls getDylinkMetadata() and refuses a grammar wasm without the newer emscripten dylink section. A wasm built by tree-sitter CLI 0.26.9 carries that section and loads on BOTH runtimes, so the migration is a REBUILD of the stragglers, not a version bump. Until that rebuild is done and measured, 0.25.9 is the correct pin.",
      phaseA: {
        runtime0259: { grammarsLoaded: 53, grammarsTotal: 55, failures: ["tree-sitter-elm.wasm", "tree-sitter-ql.wasm"] },
        runtime0270: { grammarsLoaded: 35, grammarsTotal: 55, failures: 20 },
        cli0269BuildOnRuntime0259: "pass",
        cli0269BuildOnRuntime0270: "pass",
        elmAndQlFailOnTheCurrentRuntime: true,
      },
    },
    treeSitterCli: {
      installed: cli,
      rule:
        "CLI 0.26.9 is the only builder measured to produce a wasm that loads on both the pinned runtime and the next one. Any grammar rebuilt with an older CLI (groovy and scala were built with 0.22.6 + emscripten 3.1.64) is a migration candidate, not a fixed artifact.",
    },
  }
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n")
writeFileSync(OUT, JSON.stringify(registry, null, 2) + "\n")

console.log(`build-grammar-survey: ${rows.length} lane(s) -> ${path.relative(ROOT, OUT)}  [${registry.generatorMode}, ${networkCalls} network call(s)]`)
console.log(`  declared version unknown        : ${versionUnknown.length}  ${versionUnknown.join(", ") || "-"}`)
console.log(`  claim NOT bound to a grammar    : ${unboundClaims.length} of ${rows.filter((r) => r.evidence.m12.artifact).length} artifacts`)
console.log(`  bound but hash MISMATCH         : ${misboundClaims.length}  ${misboundClaims.join(", ") || "-"}`)
console.log(`  declared sha256 != shipped bytes: ${shaMismatch.length}  ${shaMismatch.join(", ") || "-"}`)
console.log(`  no F5 differential and no F10   : ${noGuard.length}`)
console.log(`  not rebuildable from the repo   : ${notRebuildable.length}`)

// The survey, split so the three different situations are never read as one.
// A single flat list mixed "a better grammar exists", "we never wrote down what
// we pinned", and "this lane has no grammar at all" into one ranking by damage,
// which made a 1-of-2-file lane look like a 50% failure next to sql's real 70%.
//
// The rate is printed with its denominator for the same reason: a percentage
// without n is not a measurement.
const withRate = (r: any) =>
  r.evidence.m12.errorRatePct == null
    ? "      n/a"
    : `${String(r.evidence.m12.errorRatePct).padStart(6)}% n=${r.evidence.m12.measuredFiles ?? "?"}`

const swappable = rows
  .filter((r) => r.staleness.hasAheadCandidate)
  .sort((a, b) => (b.evidence.m12.errorRatePct ?? -1) - (a.evidence.m12.errorRatePct ?? -1))
const unrecorded = rows
  .filter((r) => !r.declared.versionKnown && !r.generic && !r.aliasOf)
  .sort((a, b) => (b.evidence.m12.errorRatePct ?? -1) - (a.evidence.m12.errorRatePct ?? -1))
const noOwnGrammar = rows.filter((r) => r.generic || r.aliasOf)

if (swappable.length) {
  console.log(`\n  A. A CANDIDATE GRAMMAR IS AHEAD (${swappable.length}) — the possible swaps. Shortlist only; F11 decides.`)
  for (const r of swappable) {
    console.log(`    ${r.lane.padEnd(13)} we=${String(r.declared.version ?? "(none)").padEnd(9)} ownUp=${String(r.upstream.available ? r.upstream.latestVersion : "(unresolved)").padEnd(11)} dmg=${withRate(r)}`)
    for (const a of r.staleness.aheadCandidates.slice(0, 5)) {
      console.log(
        `        -> ${String(a.package).padEnd(44)} ${String(a.version).padEnd(16)} ${String(a.published).padEnd(11)}${a.archived ? "ARCHIVED " : ""}${a.isFork ? "fork " : ""}stars=${a.stars ?? "?"} pushed=${a.pushedAt ?? "?"}`,
      )
    }
  }
}

if (unrecorded.length) {
  console.log(`\n  B. NO VERSION RECORDED (${unrecorded.length}) — bookkeeping debt, not necessarily a stale grammar.`)
  for (const r of unrecorded) {
    console.log(`    ${r.lane.padEnd(13)} declared=(none)     upstreamLatest=${String(r.upstream.available ? r.upstream.latestVersion : "(unresolved)").padEnd(11)} dmg=${withRate(r)}`)
  }
}

if (noOwnGrammar.length) {
  console.log(`\n  C. NO GRAMMAR OF THEIR OWN (${noOwnGrammar.length}) — not actionable; recorded so the count reconciles.`)
  for (const r of noOwnGrammar) {
    console.log(`    ${r.lane.padEnd(13)} ${r.generic ? "generic (GenericAnalyzer, no grammar)" : `alias of ${r.aliasOf}`}`)
  }
}
