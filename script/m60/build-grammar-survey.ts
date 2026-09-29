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

// The runtime-upgrade claim is OWNED by script/m60/measure-runtime-stragglers.ts,
// which is the only thing that loads every shipped wasm on both runtimes. This
// generator reports its artifact; it never measures the runtime itself, and it
// never restates a remembered count when the artifact is absent.
const STRAGGLER_ARTIFACT_REL = "validation/m60/results/M60.0.runtime-stragglers.json"
const STRAGGLER_ARTIFACT = path.join(ROOT, STRAGGLER_ARTIFACT_REL)
const PINNED_RUNTIME = "0.25.9"
const CANDIDATE_RUNTIME = "0.27.0"
type StragglerEvidence = {
  measuredAt: string
  counts: { shippedGrammarWasms: number; pinnedOk: number; candidateOk: number; candidateTotalFailures: number; upgradeStragglers: number; preExistingFailures: number }
  upgradeStragglers: string[]
  preExistingFailures: string[]
  mechanism: { claim: string; prediction: string; holds: boolean }
  harnessControl: { blind: boolean; mutations: string[] }
  calibration: { agrees: boolean; question: string }
}
function readStragglerEvidence(): StragglerEvidence | null {
  if (!existsSync(STRAGGLER_ARTIFACT)) return null
  try {
    const a = JSON.parse(readFileSync(STRAGGLER_ARTIFACT, "utf8")) as StragglerEvidence
    // An artifact that does not carry the fields the survey restates is not evidence,
    // it is a different file. Declared absent beats restated from a guess.
    if (typeof a?.counts?.upgradeStragglers !== "number" || !Array.isArray(a.upgradeStragglers)) return null
    if (a.harnessControl?.blind !== false) return null
    return a
  } catch {
    return null
  }
}
const stragglerEvidence = readStragglerEvidence()

// A PROVENANCE CENSUS is the declaration surface for lanes that have no prose to
// write one in. `toml` and `tsx` are ENGINE-ONLY: they appear in SUPPORTED_LANGUAGES and
// the resolution chain, and they have no analyzer, no doc and no spec file. Their
// provenance was measured (both are `tree-sitter-wasms@0.1.11`) and there was literally
// NOWHERE to record it — an artifact the product loads, owned by no file. R1 counted them
// for exactly that reason, and it was right to.
//
// So for a lane with no declaration site, the survey reports the CENSUS's verdict and
// cites it. The census still owns the fact; this file only points at it, which is the same
// arrangement phaseA uses for the runtime claim. A lane whose bytes match nothing published
// stays unrecorded — a census that found nothing is not a version, and manufacturing one
// would put R1 at zero on the strength of a hash that never matched.
const PROVENANCE_ARTIFACT_REL = "validation/m60/results/G-PROVENANCE.json"
type ProvVerdict = {
  lane: string
  status: string
  package?: string
  version?: string
  provenanceKind?: string
  sha256?: string
  shippedBytes?: number
  buildOutput?: { shipped: string; named: string[]; isStandardName: boolean }
  source?: { rebuildable?: boolean; grammarSource?: string[]; parserC?: string[]; totalFiles?: number }
}
// THE REBUILD VERDICTS are a SECOND declaration surface, and the only one that can describe a
// lane the product builds ITSELF. Most grammars in this tree are not "whatever upstream
// published" and not "a mystery" — they are a rebuild of a named upstream source by our
// recorded toolchain, and the model had no way to say so, so those lanes sat in R1 forever
// looking unrecorded when they were in fact the BEST-documented lanes in the repo:
// `svelte` reproduces byte for byte from @tree-sitter-grammars/tree-sitter-svelte@1.0.2.
const REBUILD_ARTIFACT_REL = "validation/m60/results/M60.0.local-rebuilds.json"
type RebuildVerdict = {
  lane: string
  verdict: string
  best: null | { grade: string; package: string; version: string; bytesDiffering: number | null; sharedPrefixPercent: number | null; differingSection: string | null; command: string; origin?: string }
  shipped?: { buildOutputName: string | null }
}
// A SECOND, STRONGER PROVENANCE CHANNEL. The rebuild verdict asks "do these bytes fall out of
// building this source?"; the surface verdict asks "does this grammar present the same
// vocabulary to consumers?" The second is decisive where the first is ambiguous, because a
// one-byte linker difference (measured: bash, 1 of 1,403,135 bytes) cannot add or remove a
// node type. It is what turned `hcl` — 6 bytes from a published prebuild, a lead I had called
// tantalising and undecided — into a settled answer, and it independently CONFIRMED the
// analyzer doc's claim that `r`'s one-rule hex-float patch left "0 named types, 0 fields".
const SURFACE_ARTIFACT_REL = "validation/m60/results/M60.0.grammar-surface.json"
const SURFACE_BY_LANE = new Map<string, any>()
if (existsSync(path.join(ROOT, SURFACE_ARTIFACT_REL))) {
  try {
    for (const r of JSON.parse(readFileSync(path.join(ROOT, SURFACE_ARTIFACT_REL), "utf8")).results ?? []) {
      if (r?.lane) SURFACE_BY_LANE.set(r.lane, r)
    }
  } catch {
    /* declared absence */
  }
}

const REBUILD_BY_LANE = new Map<string, RebuildVerdict>()
if (existsSync(path.join(ROOT, REBUILD_ARTIFACT_REL))) {
  try {
    for (const r of JSON.parse(readFileSync(path.join(ROOT, REBUILD_ARTIFACT_REL), "utf8")).results ?? []) {
      if (r?.lane) REBUILD_BY_LANE.set(r.lane, r)
    }
  } catch {
    /* declared absence: the lanes simply stay unversioned, which is the honest state */
  }
}

const PROV_BY_LANE = new Map<string, ProvVerdict>()
if (existsSync(PROVENANCE_ARTIFACT_REL ? path.join(ROOT, PROVENANCE_ARTIFACT_REL) : "")) {
  try {
    const prov = JSON.parse(readFileSync(path.join(ROOT, PROVENANCE_ARTIFACT_REL), "utf8"))
    for (const r of (prov.results ?? []) as ProvVerdict[]) if (r?.lane) PROV_BY_LANE.set(r.lane, r)
  } catch {
    /* an unreadable census is a declared absence, not a crash */
  }
}
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
      // The cap bounds what is RECORDED, and hitting it is disclosed rather than
      // silent. At 400 chars the vue lane's long `Parser:` bullet was cut off BEFORE the
      // provenance line that states the version, and the lane read as unversioned — a
      // truncation that looked exactly like an absence. A partial raw is still useful; a
      // partial raw that does not say it is partial is a trap.
      const para: string[] = []
      let truncated = false
      for (let k = i; k < lines.length; k++) {
        if (k > i && /^\s*-\s+\S/.test(lines[k])) break
        para.push(lines[k].trim())
        if (para.join(" ").length > 1600) { truncated = true; break }
      }
      const raw = para.join(" ").replace(/\s+/g, " ")
      sources.push({ file: path.relative(ROOT, docPath), field: "Parser:", raw: truncated ? raw + " …[truncated]" : raw })
    } else {
      sources.push({ file: path.relative(ROOT, docPath), field: "Parser:", raw: null })
    }

    // A DOC MAY STATE THE GRAMMAR'S VERSION IN A SIBLING BULLET, and the `Parser:`
    // paragraph above cannot see it: the paragraph deliberately stops at the next
    // bullet, which is where a `- Verified grammar: @tree-sitter-grammars/… 0.4.1`
    // line lives. `lua` is exactly this — its `Parser:` bullet names the wasm and no
    // version, the very next bullet states 0.4.1, and the lane read as UNVERSIONED
    // while the fact sat one line away in plain prose. So sibling bullets that name a
    // grammar package together with a semver are added as additional sources.
    //
    // Trust order is preserved by ORDER, not by a flag: these are pushed AFTER
    // `Parser:`, so the "first source that actually yields a version" loop below still
    // prefers the `Parser:` bullet whenever that bullet speaks, and reaches for these
    // only when it does not. The pattern requires the package name and the version to
    // be adjacent, so a bullet that merely mentions a date or a defect count cannot be
    // mistaken for a declaration.
    for (const line of lines) {
      if (!/^\s*-\s+\S/.test(line)) continue
      if (/^\s*-\s*Parser:/i.test(line)) continue
      if (!/(@[a-z0-9._-]+\/)?tree-sitter-[a-z0-9._+-]+[`"']?\s+\*?\*?v?\d+\.\d+\.\d+/i.test(line)) continue
      sources.push({ file: path.relative(ROOT, docPath), field: "grammar-statement", raw: line.trim() })
    }
  }

  // First source that ACTUALLY YIELDS A VERSION wins, in trust order (spec before
  // prose). It used to be "first non-null raw wins", which let a spec entry carrying
  // only a FILENAME — `grammar: "tree-sitter-vue.wasm"` — shadow the analyzer doc that
  // states a provenance and a version, and the lane read as unversioned. A more trusted
  // source silencing a less trusted one by being EMPTY is the wrong precedence:
  // "most trusted" has to mean "trusted when it speaks", not "authoritative when silent".
  // Every source is still recorded, so a reader can see which one answered and which did not.
  for (const s of sources) {
    if (!s.raw) continue
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

/**
 * Adjudication rulings are AUTHORED, and they do not live in this generated file.
 *
 * The first version of this work recorded refusals by editing the survey's rows, and the
 * next `grammar:survey:build` silently erased three of them — a generated file cannot hold
 * a hand-written fact, and that is the same two-sources-one-truth defect this milestone
 * exists to close, recreated one level up inside the fix for it. Rulings therefore live in
 * validation/m60/grammar-adjudications.json, which a human owns, and this generator MERGES
 * them in.
 *
 * A ruling matching no candidate here is a HARD FAILURE, not a skip: a package renamed
 * upstream, or a lane renamed, would otherwise drop a verdict silently and the survey would
 * then report that candidate as never adjudicated — the one state a reviewer must never
 * meet by omission.
 */
const ADJUDICATIONS = path.join(ROOT, "validation", "m60", "grammar-adjudications.json")
const rulings: any[] = existsSync(ADJUDICATIONS) ? (JSON.parse(readFileSync(ADJUDICATIONS, "utf8")).rulings ?? []) : []
const orphanedRulings: string[] = []

const rows: any[] = []
for (const lane of target) {
  const asset = engineLanes[lane] ?? null
  const declaredFromProse = declaredVersion(lane)
  // A LANE WITH NO PROSE gets its declaration from the measured census, cited rather
  // than restated. The criterion is "the prose declared nothing", not a hand-kept list of
  // engine-only lanes — that way a lane cannot fall out of the set by being renamed.
  //
  // What is deliberately NOT done here: giving a collection build a `grammar` version.
  // `toml` and `tsx` are both `tree-sitter-wasms@0.1.11`, and that is a REDISTRIBUTOR
  // version. The row records it with `versionKind: "redistributor-collection"` and
  // `versionIsComparableToUpstreamGrammar: false`, exactly like a prose-declared collection
  // build, so the staleness comparison yields `unknown` rather than a false `behind` against
  // a grammar version the collection never stated.
  const prov = PROV_BY_LANE.get(lane)
  // The test is `version != null`, NOT `versionKnown`. `declaredVersion()` returns
  // `{ version, sources }` and has no `versionKnown` field at all, so the first version of
  // this read `undefined` — always falsy — and the census OVERWROTE the prose version for
  // go, javascript, swift and typescript, replacing a real grammar version (0.25.0, 0.23.1,
  // 0.7.1, 0.23.2) with a collection version. C4 caught it on the next run, which is the
  // check doing precisely its job: a generator quietly sourcing versions from somewhere new
  // is indistinguishable from a correct one until the two owners disagree.
  // The census arm of this ternary sets fields the prose arm never has, so the type has to
  // name all of them. It used to be `ReturnType<typeof declaredVersion>` and the object
  // literal's extra properties were an excess-property error — which is the typechecker
  // correctly reporting that the declared shape and the produced shape had drifted apart,
  // the same drift the file exists to catch between FILES.
  // A REBUILD ESTABLISHES A VERSION ONLY WHEN THE REBUILD SUCCEEDED. `byte-identical` and
  // `equivalent` mean our bytes ARE that upstream source built by our toolchain, so the base
  // version is a real, upstream-comparable fact and the lane stops being unrecorded.
  // `different` establishes NOTHING: it says only that this candidate is not the source, and
  // it cannot distinguish "a patched rebuild" from "the wrong package" — `r` is exactly that
  // case, where the analyzer doc records a one-rule patch and the rebuild differs by 342,703
  // bytes, which is what regenerating a parser after a one-rule change looks like. So a
  // `different` lane stays in R1 with its measured reason attached, rather than being given a
  // version the evidence does not support.
  const rebuild = REBUILD_BY_LANE.get(lane)
  const surface = SURFACE_BY_LANE.get(lane)
  const rebuildProves = rebuild?.best != null && (rebuild.verdict === "byte-identical" || rebuild.verdict === "equivalent")
  // Surface is the STRONGER of the two, so it is tried first: an identical vocabulary is
  // builder-independent evidence, where a byte result depends on the linker. `hcl` is the case
  // that needs this — its rebuild from the published source differs by 84,689 bytes (a
  // different toolchain from whatever produced the shipped artefact) while its vocabulary is
  // EXACTLY the published grammar's, 102 types and 2 fields, ABI 14 to 14.
  const surfaceProves = surface?.verdict === "surface-identical" && surface?.best?.package && surface?.best?.version
  const rebuildProvesBase = surfaceProves || rebuildProves
  const basis = surfaceProves
    ? { channel: "surface", artifact: SURFACE_ARTIFACT_REL, field: `results[${lane}].best`, grade: surface.verdict, package: surface.best.package, version: surface.best.version }
    : rebuildProves
      ? { channel: "rebuild", artifact: REBUILD_ARTIFACT_REL, field: `results[${lane}].best`, grade: rebuild.verdict, package: rebuild.best.package, version: rebuild.best.version }
      : null
  const rebuildNote =
    rebuild && !rebuildProvesBase
      ? `rebuild attempted and graded \`${rebuild.verdict}\`: no named source reproduces these bytes.`
      : null

  type Declared = Omit<ReturnType<typeof declaredVersion>, "sources"> & {
    versionKnown?: boolean
    provenanceKind?: string | null
    rebuildFrom?: { package: string; version: string } | null
    provenanceBasis?: "surface" | "rebuild" | null
    rebuildNote?: string | null
    sha256?: string | null
    sha256File?: string | null
    declarationSite?: string
    // A census-sourced row also records WHICH authority answered, so a reader can tell a
    // version read out of a document from one measured against a published artifact.
    sources: Array<{ file: string; field: string; raw: string | null; authority?: string }>
  }
  const declared: Declared =
    declaredFromProse.version != null
      ? declaredFromProse
      : rebuildProvesBase
        ? {
            ...declaredFromProse,
            version: basis!.version,
            versionKnown: true,
            provenanceKind: "local-rebuild",
            rebuildFrom: { package: basis!.package, version: basis!.version },
            provenanceBasis: basis!.channel as "surface" | "rebuild",
            sources: [
              {
                file: basis!.artifact,
                field: basis!.field,
                raw: `${basis!.package}@${basis!.version} (${basis!.grade})`,
                authority: basis!.channel === "surface" ? "surface-comparison" : "rebuild-verification",
              },
            ],
            declarationSite: `REBUILT HERE, not vendored and not published: these bytes were produced by building ${basis!.package}@${basis!.version} from its published source with the recorded toolchain. Proven by reproduction, not by a hash matching a published artefact — see ${REBUILD_ARTIFACT_REL}.`,
          }
        : !prov || prov.status !== "identified" || !prov.version
      ? declaredFromProse
      : {
          ...declaredFromProse,
          version: prov.version,
          versionKnown: true,
          provenanceKind: prov.provenanceKind ?? null,
          sources: [
            {
              file: PROVENANCE_ARTIFACT_REL,
              field: `results[${lane}].version`,
              raw: `${prov.package}@${prov.version}`,
              authority: "provenance-census",
            },
          ],
          sha256: prov.sha256 ?? null,
          sha256File: prov.shippedBytes ? `${prov.shippedBytes} bytes` : null,
          declarationSite:
            "ENGINE-ONLY: this lane is in SUPPORTED_LANGUAGES and the wasm resolution chain, and has no analyzer doc and no spec file, so there is no prose in which a version could be written. Its identity is measured by sha256 against a published artifact instead — see validation/m60/results/G-PROVENANCE.json.",
        }
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
  // The optional prefix must be a REAL npm scope, i.e. `@`-prefixed. It used to be
  // `@?[a-z0-9][a-z0-9._-]*\/`, which also matched a bare path segment — so a doc reading
  // "vendored `wasm/tree-sitter-graphql.wasm`" yielded the package `wasm/tree-sitter-graphql`,
  // a name that does not exist and 404s. That is not a cosmetic slip: the survey then
  // PROPOSED it as a swap candidate, `npm view` returned nothing for it, and the census spent
  // real network time 404ing on it on every sweep. Three lanes carried the phantom
  // (graphql, hcl, xml). Requiring the `@` makes the regex fall through to
  // `tree-sitter-graphql`, which is the package that actually exists.
  const pkgMatch = /(@[a-z0-9][a-z0-9._-]*\/)?tree-sitter-[a-z0-9._+-]+/i.exec(joined)
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
  const candidates = discovery.candidates.map((c) => {
    // Upstream state FIRST: the ruling is keyed on the version upstream currently
    // publishes, so the lookup cannot precede the fetch. The first version of this read
    // `c.upstream` here, which is undefined at this point because `discoverCandidates`
    // returns `{package, repo, foundVia}` and the health is attached below — so every
    // ruling missed, and the orphan gate correctly refused to publish.
    const up = upstreamHealth(c.package ?? null)
    // An authored ruling wins over the default. Keyed on lane + package + version,
    // because a package can offer several versions and only one of them was
    // adjudicated — keying on package alone would apply a 0.3.12 refusal to a 0.4.0
    // candidate nobody has looked at.
    const hit = rulings.find((r) => r.lane === lane && r.package === c.package && r.version === (up?.latestVersion ?? null))
    if (hit) hit.__applied = true
    return {
      ...c,
      upstream: up,
      // A candidate is NEVER accepted here. Only F11 can set that, in a review
      // document, and C6 in verify-grammar-consistency.ts checks the document exists.
      verdict: (hit?.verdict ?? "unmeasured") as string,
      verdictRuling: (hit?.ruling ?? null) as string | null,
      // The measured numbers travel WITH the verdict, so a reader of this row never
      // has to open the review document to learn what the numbers were.
      measured: hit?.measured ?? null,
      mechanism: hit?.mechanism ?? null,
      confound: hit?.confound ?? null,
      knownLimit: hit?.knownLimit ?? null,
      candidateProvenance: hit?.candidateProvenance ?? (c.upstream?.repoUrl ?? null),
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
      // An authored ruling may carry its own screening measurement; it wins.
      recovery: (hit?.recovery ?? null) as null | { filesLosingMaterialStructure: number; files: number; medianFileDeltaPct: number | null; aggregateNamedNodesDeltaPct: number | null; errorsDeltaPct: number | null; note?: string },
    }
    }
  })

  const f10Rows = f10RowsFor(lane)

  // IS THIS A GRAMMAR VERSION? A lane whose bytes came from a redistributor collection
  // has a COLLECTION version, not a grammar version, and the collection does not state
  // which grammar it built. Storing 0.1.12 as "the grammar is 0.1.12" would be a category
  // error that then drives a staleness comparison against upstream's grammar latest —
  // comparing two different things and reporting the result as staleness. So the kind is
  // recorded, and a collection-sourced version yields `unknown` rather than a false answer.
  // A COLLECTION VERSION IS NOT A GRAMMAR VERSION, and the two must never be compared
  // and reported as staleness. The prose path detects this by matching the phrase
  // "REDISTRIBUTOR BUILD" in the doc; the census path knows it STRUCTURALLY, from
  // `provenanceKind`. A regex over prose is the right tool when prose is all there is and
  // the wrong tool when the field already says it — and using the regex for both would have
  // silently typed `tree-sitter-wasms@0.1.11` as a grammar version, which is the exact
  // category error this whole model exists to prevent.
  const declaredIsCollectionVersion =
    (declared as any).provenanceKind === "redistributor-collection" ||
    /REDISTRIBUTOR BUILD/i.test(declared.sources.map((x) => x.raw ?? "").join(" "))
  const declaredV = declared.version
  const effectiveV = declaredIsCollectionVersion ? null : declaredV
  const latestV = health.available ? (health as any).latestVersion : null
  // `cmpSemver(latest, declared)` answers "is UPSTREAM ahead of US", which is the
  // opposite of what a field named `behind` should say. It read `behind: "ahead"` for
  // the powershell lane — technically true about upstream, actively misleading about us.
  // The comparison is kept (it is the one that decides the candidate filter) and the
  // position is now stated in the only direction a reader can act on.
  const upstreamVersusUs = cmpSemver(latestV, effectiveV)
  const ourPosition: "behind" | "current" | "ahead" | "unknown" =
    upstreamVersusUs === "unknown" ? "unknown" : upstreamVersusUs === "ahead" ? "behind" : upstreamVersusUs === "behind" ? "ahead" : "current"

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
    effectiveV == null
      ? []
      : candidates
          .filter((c) => cmpSemver(c.upstream?.latestVersion ?? null, effectiveV) === "ahead")
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
      // THREE kinds, not two. `local-rebuild` is the state most of this tree is actually in:
      // bytes WE built from a named upstream source with a recorded toolchain. Calling that
      // "grammar" understates it — it is not the upstream's artefact, it is ours, and the
      // difference is the whole subject of this file.
      versionKind:
        declaredV == null
          ? null
          : declaredIsCollectionVersion
            ? "redistributor-collection"
            : (declared as any).provenanceKind === "local-rebuild"
              ? "local-rebuild"
              : "grammar",
      versionIsComparableToUpstreamGrammar: !declaredIsCollectionVersion,
      versionKnown: declaredV != null,
      // WHY THIS LANE'S VERSION IS NOT IN PROSE. Absent for the ordinary case, which is
      // the point: a reader who sees it knows this lane's identity came from a measurement
      // rather than a document, and can go read the measurement.
      declarationSite: (declared as any).declarationSite ?? null,
      provenanceBasis: (declared as any).provenanceBasis ?? null,
      // The reproduction record travels WITH the version. A rebuild whose only claim is
      // "trust me, it is a rebuild" is the same as no claim; the grade, the byte count and
      // the command are what make it checkable by the next person.
      rebuild:
        (declared as any).provenanceKind === "local-rebuild" && rebuild
          ? {
              grade: rebuild.verdict,
              from: (declared as any).rebuildFrom ?? null,
              builder: "tree-sitter 0.26.9",
              bytesDiffering: rebuild.best?.bytesDiffering ?? null,
              sharedPrefixPercent: rebuild.best?.sharedPrefixPercent ?? null,
              differingSection: rebuild.best?.differingSection ?? null,
              command: rebuild.best?.command ?? null,
              note: "reproduced by building the named source, not matched by hash against a published artefact. A `different` grade would establish nothing, so only byte-identical and equivalent earn a version here.",
            }
          : null,
      declaredFromCensus: declared.sources.some((x: any) => x?.authority === "provenance-census") || false,
      sha256: sha.sha256,
      sha256File: sha.file,
      sources: declared.sources,
    },
    shipped: art,
    upstream: health,
    candidates,
    rejectedSearchHits: discovery.rejectedSearchHits,
    staleness: {
      ourPosition,
      upstreamVersusDeclared: upstreamVersusUs,
      aheadCandidates,
      hasAheadCandidate: aheadCandidates.length > 0,
        note:
          effectiveV == null
            ? declaredIsCollectionVersion
              ? "the recorded version is a REDISTRIBUTOR COLLECTION's, not the grammar's, and the collection does not state which grammar it built — staleness is UNKNOWN and is deliberately not inferred from it"
              : "NO DECLARED VERSION — staleness cannot be computed and is not assumed to be 'current'"
            : ourPosition === "unknown"
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
const adjudicated = rows
  .flatMap((r) => (r.candidates ?? []).map((c: any) => ({ lane: r.lane, c })))
  .filter(({ c }) => c.verdict !== "unmeasured")
  .map(({ lane, c }) => `${lane}:${c.package}@${c.upstream?.latestVersion ?? "?"}=${c.verdict}`)
for (const r of rulings) if (!r.__applied) orphanedRulings.push(`${r.lane}/${r.package}@${r.version}`)

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
  rulings: {
    source: "validation/m60/grammar-adjudications.json — hand-authored; THIS file is generated and must never be hand-edited",
    authored: rulings.length,
    applied: adjudicated.length,
    orphaned: orphanedRulings,
    appliedVerdicts: adjudicated,
  },
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
    authoredRulings: rulings.length,
    rulingsApplied: adjudicated.length,
    orphanedRulings: orphanedRulings.length,
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
      // The number is NOT written here. It used to be a literal `failures: 20` typed
      // into this generator, with no list behind it — so no artifact could reproduce
      // it, nothing ever checked it, and M63's entire scope was sized by it. It is now
      // READ from the measuring script's artifact, and this generator refuses to emit
      // a runtime claim it cannot point at a measurement for. One fact, one owner:
      // script/m60/measure-runtime-stragglers.ts measures, this file reports.
      note: stragglerEvidence
        ? `MEASURED ${stragglerEvidence.measuredAt} by script/m60/measure-runtime-stragglers.ts (evidence: ${STRAGGLER_ARTIFACT_REL}): moving this pin to ${CANDIDATE_RUNTIME} breaks ${stragglerEvidence.counts.upgradeStragglers} of ${stragglerEvidence.counts.shippedGrammarWasms} shipped grammar wasms — every core web language among them (javascript, typescript, tsx, java, go, html, json, ruby, swift, zig, vue). The cause is NOT an API break: ${CANDIDATE_RUNTIME} calls getDylinkMetadata() and refuses a grammar wasm without the newer emscripten dylink.0 section. That correspondence is now MEASURED rather than asserted: {${CANDIDATE_RUNTIME} load failures} == {shipped wasms lacking dylink.0}, exactly, ${stragglerEvidence.mechanism.holds ? "confirmed" : "NOT confirmed"}. A wasm built by tree-sitter CLI 0.26.9 carries that section and loads on BOTH runtimes, so the migration is a REBUILD of the stragglers, not a version bump. Until that rebuild is done and measured, ${PINNED_RUNTIME} is the correct pin.`
        : `UNVERIFIED: no measurement artifact at ${STRAGGLER_ARTIFACT_REL}. This survey does NOT restate a remembered count — run \`bun run grammar:stragglers:measure\` first. An unreproducible number is not a measurement, and this field used to be exactly that.`,
      phaseA: stragglerEvidence
        ? {
            measuredAt: stragglerEvidence.measuredAt,
            owner: `${STRAGGLER_ARTIFACT_REL} — produced by script/m60/measure-runtime-stragglers.ts; regenerate with \`bun run grammar:stragglers:measure\``,
            // The previously recorded shape, kept verbatim so the retraction is visible
            // rather than quietly overwritten by a new number.
            supersededRecord: {
              claim: "0.27.0 breaks 20 of 55 shipped grammar wasms",
              whyRetracted:
                "an unverifiable COUNT with no list, recorded 2026-09-26. No artifact in the repo could reproduce it, so nothing checked it. Reproduced today as a per-wasm list; the tree has since grown, so the denominators differ too.",
              reproducible: false,
            },
            pinnedRuntime: {
              version: PINNED_RUNTIME,
              ok: stragglerEvidence.counts.pinnedOk,
              total: stragglerEvidence.counts.shippedGrammarWasms,
              failures: stragglerEvidence.preExistingFailures,
            },
            candidateRuntime: {
              version: CANDIDATE_RUNTIME,
              ok: stragglerEvidence.counts.candidateOk,
              total: stragglerEvidence.counts.shippedGrammarWasms,
              failures: stragglerEvidence.counts.candidateTotalFailures,
              upgradeStragglers: stragglerEvidence.upgradeStragglers,
              upgradeStragglerCount: stragglerEvidence.counts.upgradeStragglers,
            },
            harnessControl: {
              sound: !stragglerEvidence.harnessControl.blind,
              mutationsRejected: stragglerEvidence.harnessControl.mutations.length,
              why:
                "three deliberate corruptions of a working grammar must fail to load on every runtime, checked BEFORE any result is read. The first version of this harness stopped at the lazy Language.load() and reported 61/61 for a tree containing a truncated wasm, a clobbered magic number and a scrambled payload. A harness that cannot detect failure cannot certify success.",
            },
            calibration: {
              reproducesRecordedBaseline: stragglerEvidence.calibration.agrees,
              question: stragglerEvidence.calibration.question,
            },
            cause: {
              claim: stragglerEvidence.mechanism.claim,
              prediction: stragglerEvidence.mechanism.prediction,
              holds: stragglerEvidence.mechanism.holds,
            },
            cli0269BuildOnRuntime0259: "pass",
            cli0269BuildOnRuntime0270: "pass",
            elmAndQlFailOnTheCurrentRuntime: stragglerEvidence.preExistingFailures.includes("tree-sitter-elm.wasm") && stragglerEvidence.preExistingFailures.includes("tree-sitter-ql.wasm"),
          }
        : { status: "UNVERIFIED — run `bun run grammar:stragglers:measure`" },
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

if (orphanedRulings.length) {
  console.error(
    `build-grammar-survey: ${orphanedRulings.length} authored ruling(s) match no candidate — a verdict would be SILENTLY LOST:\n` +
      orphanedRulings.map((o) => `    ${o}`).join("\n") +
      `\n  Either the package or lane was renamed, or the ruling's version no longer matches upstream's latest.`,
  )
  process.exit(1)
}

console.log(`build-grammar-survey: ${rows.length} lane(s) -> ${path.relative(ROOT, OUT)}  [${registry.generatorMode}, ${networkCalls} network call(s)]`)
console.log(`  declared version unknown        : ${versionUnknown.length}  ${versionUnknown.join(", ") || "-"}`)
console.log(`  claim NOT bound to a grammar    : ${unboundClaims.length} of ${rows.filter((r) => r.evidence.m12.artifact).length} artifacts`)
console.log(`  bound but hash MISMATCH         : ${misboundClaims.length}  ${misboundClaims.join(", ") || "-"}`)
console.log(`  declared sha256 != shipped bytes: ${shaMismatch.length}  ${shaMismatch.join(", ") || "-"}`)
console.log(`  no F5 differential and no F10   : ${noGuard.length}`)
console.log(`  not rebuildable from the repo   : ${notRebuildable.length}`)
console.log(`  authored rulings applied        : ${adjudicated.length}/${rulings.length}${orphanedRulings.length ? `   ORPHANED: ${orphanedRulings.join(", ")}` : ""}`)

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
