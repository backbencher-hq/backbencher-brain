// script/m60/find-grammar-provenance.ts — identify an UNVERSIONED shipped grammar by
// byte-identity against the published artifacts.
//
// WHY. Nineteen lanes shipped a grammar whose version was recorded NOWHERE — not in the
// analyzer doc, not in a spec file, not in a registry. Two consequences, both measured:
//
//   1. The grammar survey could not compare those lanes to upstream at all, so they never
//      appeared in its "a candidate grammar is ahead" shortlist. `powershell` was the
//      second-worst lane in the tree at 32.9% of its corpus failing to parse, and nobody
//      could ask whether a newer grammar would help. It was 3 releases behind. Establishing
//      that took one `npm pack` and one `sha256sum`.
//
//   2. The runtime migration (M63) has to rebuild 20 grammars from source, and "which
//      version are we on" is the first question a rebuild asks. A lane with no version is a
//      lane that cannot be rebuilt.
//
// So the method is worth automating, and it is worth automating HONESTLY: the answer is a
// HASH MATCH or it is nothing. This instrument never infers a version from a file size, a
// date, or a doc's prose, and when nothing matches it says so — because "this artifact is a
// local build of unknown ancestry" is a real and important answer, and a near-miss reported
// as a match would be worse than no answer.
//
// WHAT IT DOES, per lane:
//   - derives candidate npm package names from the engine's own grammar asset, the survey's
//     discovered candidates, and a small declared alias table for the known divergences
//     (`tree-sitter-c_sharp` -> `tree-sitter-c-sharp`, and so on);
//   - walks that package's published versions newest-first;
//   - downloads each tarball, extracts ONLY the `.wasm`, and compares sha256 against the
//     bytes the product actually loads;
//   - reports EXACT matches, and otherwise reports the closest by BYTE LENGTH clearly
//     labelled as a lead and not a match.
//
// It is offline-safe in the sense that it never mutates the repository: it writes one
// artifact and touches no grammar, no wasm, and no declaration site. Deciding what to do
// with an answer is a human's job, recorded in the `Parser:` line.
//
// Usage:
//   bun run script/m60/find-grammar-provenance.ts                    # every unversioned lane
//   bun run script/m60/find-grammar-provenance.ts --lane powershell  # one lane
//   bun run script/m60/find-grammar-provenance.ts --all              # including versioned lanes
//   bun run script/m60/find-grammar-provenance.ts --max-versions 8   # widen the version walk
//   bun run script/m60/find-grammar-provenance.ts --json
//
// Writes: validation/m60/results/G-PROVENANCE.json   (a measurement, not a claim)

import { execFileSync } from "node:child_process"

// PROGRESS MUST BE UNBUFFERED, or a sweep cannot be monitored. `process.stderr.write`
// is block-buffered when stderr is a FILE rather than a TTY, so a 30-minute run
// redirected to a log emits almost nothing for most of its life and looks wedged.
// It was not wedged: it was silent, and I killed a healthy sweep because of it. A
// long instrument that cannot report progress cannot be supervised, and "is it
// stuck?" becomes a question nobody can answer. `fs.writeSync` on the fd is the
// only write here that is not buffered by the runtime.
const t0 = Date.now()
function progress(msg: string): void {
  try {
    writeSync(2, `[${String(Math.round((Date.now() - t0) / 1000)).padStart(5)}s] ${msg}\n`)
  } catch {
    /* progress is never worth failing a measurement over */
  }
}
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const argv = process.argv.slice(2)
const argValue = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)
const AS_JSON = argv.includes("--json")
const ALL = argv.includes("--all")
const ONLY = argValue("--lane")
const MAX_VERSIONS = parseInt(argValue("--max-versions", "6")!, 10)
const SURVEY = path.join(ROOT, "validation", "m60", "grammar-survey.json")
const OUT = path.join(ROOT, "validation", "m60", "results", "G-PROVENANCE.json")
const WASM_DIR = path.join(ROOT, "wasm")

const survey = JSON.parse(readFileSync(SURVEY, "utf8"))

/** The npm package's own metadata, which is where the declared repository lives. */
const npmMetaCache = new Map<string, any>()
function npmView(pkg: string): any {
  if (npmMetaCache.has(pkg)) return npmMetaCache.get(pkg)
  const out = sh("npm", ["view", pkg, "--json"])
  let v: any = null
  try { v = out ? JSON.parse(out) : null } catch { v = null }
  npmMetaCache.set(pkg, v)
  return v
}

/** `git+https://github.com/owner/repo.git` / `github:owner/repo` -> `owner/repo`. */
function normalizeRepo(url: string | undefined | null): string | null {
  if (!url) return null
  const m = /github\.com[:/]+([^/]+\/[^/.]+)/.exec(url)
  return m ? m[1].replace(/\.git$/, "") : null
}

/**
 * Where the engine's grammar asset name is NOT the npm package name. Declared, not
 * guessed: an undeclared divergence here produces a confident "no match found" for a lane
 * that is in fact perfectly traceable, which is the failure mode this instrument most needs
 * to avoid.
 */
const PACKAGE_ALIASES: Record<string, string[]> = {
  "tree-sitter-c_sharp": ["tree-sitter-c-sharp"],
  // tsx ships inside the typescript package; the engine's own chain says so.
  "tree-sitter-tsx": ["tree-sitter-typescript"],
  // Community grammars are published under the grammars scope, not unscoped.
  "tree-sitter-xml": ["@tree-sitter-grammars/tree-sitter-xml", "tree-sitter-xml"],
  "tree-sitter-yaml": ["@tree-sitter-grammars/tree-sitter-yaml", "tree-sitter-yaml"],
  "tree-sitter-toml": ["@tree-sitter-grammars/tree-sitter-toml", "tree-sitter-toml"],
  "tree-sitter-hcl": ["@tree-sitter-grammars/tree-sitter-hcl", "tree-sitter-hcl"],
  "tree-sitter-graphql": ["tree-sitter-graphql"],
  "tree-sitter-svelte": ["tree-sitter-svelte"],
  "tree-sitter-r": ["tree-sitter-r", "r-lib/tree-sitter-r"],
  "tree-sitter-markdown": ["tree-sitter-markdown", "@tree-sitter-grammars/tree-sitter-markdown"],
  "tree-sitter-zig": ["tree-sitter-zig"],
  "tree-sitter-html": ["tree-sitter-html"],
  "tree-sitter-json": ["tree-sitter-json"],
  "tree-sitter-lua": ["tree-sitter-lua", "@tree-sitter-grammars/tree-sitter-lua"],
  "tree-sitter-vue": ["tree-sitter-vue"],
  "tree-sitter-kotlin": ["tree-sitter-kotlin", "@tree-sitter-grammars/tree-sitter-kotlin"],
  "tree-sitter-bash": ["tree-sitter-bash"],
  "tree-sitter-ruby": ["tree-sitter-ruby"],
  "tree-sitter-java": ["tree-sitter-java"],
}

/**
 * Redistributor collections: packages that ship a prebuilt wasm for MANY grammars.
 * Tried before per-language packages because that is where most of our unversioned
 * bytes actually came from. `tree-sitter-wasms@0.1.13` alone accounts for 12 of the 46
 * wasms the product loads.
 */
const COLLECTIONS = [{ package: "tree-sitter-wasms", versions: ["0.1.13", "0.1.12", "0.1.11"] }]

/**
 * GitHub RELEASE ASSETS — a source class npm does not cover.
 *
 * Several tree-sitter grammars publish a prebuilt wasm as a release attachment rather
 * than inside the npm tarball, and for at least one lane here that attachment is the
 * ONLY published wasm: `MichaHoffmann/tree-sitter-hcl` ships
 * `tree-sitter-hcl.wasm` and `tree-sitter-terraform.wasm` on its releases, and neither is
 * in the npm package. Resolved through the npm package's own `repository` field, so the
 * repo is never guessed from the grammar name.
 *
 * Every release is walked, not just the latest: a lane can be pinned to an old attach.
 */
function ghReleaseWasms(repoSlug: string, assetNameFilter?: RegExp, maxReleases = 12): Map<string, string> {
  const idx = new Map<string, string>()
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repoSlug)) return idx
  let rels: any[] = []
  try {
    rels = JSON.parse(
      execFileSync("gh", ["api", `repos/${repoSlug}/releases?per_page=100`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 60_000 }),
    )
  } catch {
    return idx
  }
  // BOUNDED ON PURPOSE. The first version walked EVERY release and downloaded EVERY
  // wasm attachment for every lane — O(releases x assets) network calls each — and the
  // sweep stalled at 13 of 21 lanes after twenty minutes. The cap is on releases, and
  // the name filter means a lane only pays for attachments that could plausibly BE its
  // grammar (`tree-sitter-hcl.wasm` for lane `hcl`), not for every other wasm a repo
  // has ever attached.
  for (const r of rels.slice(0, maxReleases)) {
    for (const a of r.assets ?? []) {
      if (!a.name?.endsWith(".wasm")) continue
      if (assetNameFilter && !assetNameFilter.test(a.name)) continue
      try {
        const b = execFileSync("gh", ["api", `repos/${repoSlug}/releases/assets/${a.id}`, "-H", "Accept: application/octet-stream"], {
          maxBuffer: 256 * 1024 * 1024,
          timeout: 120_000,
        })
        idx.set(createHash("sha256").update(b).digest("hex"), `${repoSlug}@${r.tag_name ?? "release"}/${a.name}`)
      } catch {
        /* an asset that will not download is not a match, and is not an error worth hiding */
      }
    }
  }
  return idx
}

/**
 * Index a collection ONCE: download each version, hash every wasm inside, and keep a
 * sha256 -> "package@version/file" map. Fetched once for the whole run and matched
 * against every lane, because the collection is the same bytes for all of them.
 */
// Returns the sha256 -> `pkg@version/file.wasm` index AND, per collection version, the
// source evidence gathered in the same walk. The second return value is what turns
// "this collection publishes no source" from a remembered assertion into a count
// observed while hashing, so a future release that starts shipping `parser.c` shows up
// as a change rather than being assumed.
type CollIndex = { bySha: Map<string, string>; source: Map<string, SourceEvidence> }
const collectionIndex = (): CollIndex => {
  const bySha = new Map<string, string>()
  const source = new Map<string, SourceEvidence>()
  for (const col of COLLECTIONS) {
    for (const v of col.versions) {
      const dir = mkdtempSync(path.join(tmpdir(), "bb-coll-"))
      const ex = mkdtempSync(path.join(tmpdir(), "bb-colx-"))
      try {
        if (!sh("npm", ["pack", `${col.package}@${v}`, "--pack-destination", dir], dir)) continue
        const tgz = readdirSync(dir).filter((f) => f.endsWith(".tgz"))
        if (!tgz.length) continue
        // Exit code deliberately ignored: `tar` warns on these archives while
        // extracting them perfectly, and gating on its exit code is how the first
        // version reported "no match" for a lane whose bytes match exactly.
        sh("tar", ["xzf", path.join(dir, tgz[0]), "-C", ex])
        const ev: SourceEvidence = { grammarSource: [], parserC: [], totalFiles: 0 }
        const walk = (d: string): void => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name)
            if (e.isDirectory()) { walk(p); continue }
            ev.totalFiles++
            if (/^grammar\.(js|json|ts|mjs|cjs)$/.test(e.name)) ev.grammarSource.push(e.name)
            else if (e.name === "parser.c") ev.parserC.push(e.name)
            else if (e.name.endsWith(".wasm")) {
              bySha.set(createHash("sha256").update(readFileSync(p)).digest("hex"), `${col.package}@${v}/${e.name}`)
            }
          }
        }
        walk(ex)
        ev.rebuildable = ev.grammarSource.length > 0 && ev.parserC.length > 0
        source.set(`${col.package}@${v}`, ev)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(ex, { recursive: true, force: true })
      }
    }
  }
  return { bySha, source }
}

function sh(cmd: string, args: string[], cwd?: string): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd, timeout: 120_000 })
  } catch {
    return null
  }
}

const npmVersions = (pkg: string): string[] => {
  const out = sh("npm", ["view", pkg, "time", "--json"])
  if (!out) return []
  try {
    const t = JSON.parse(out) as Record<string, string>
    // Newest first, excluding the lifecycle keys.
    return Object.keys(t)
      .filter((k) => k !== "created" && k !== "modified")
      .sort((a, b) => Date.parse(t[b]) - Date.parse(t[a]))
  } catch {
    return []
  }
}

/**
 * Download one tarball, extract ONLY its .wasm, and return {file, bytes, sha256}.
 *
 * The extraction's EXIT CODE IS NOT THE EVIDENCE — the extracted file is. `tar xzf`
 * exits non-zero on this tarball (npm's archive carries entries that make GNU tar warn)
 * while extracting perfectly, and the first version of this helper returned null on a
 * non-zero exit and so reported "no match" for a lane whose bytes match EXACTLY. That is
 * the most dangerous failure this instrument has: it does not look like a bug, it looks
 * like a finding. So the tarball is extracted unconditionally and the RESULT is inspected
 * for the artifact, and only its absence counts as failure.
 */
// A provenance match answers "which published bytes are these?". It does NOT answer
// "can this grammar be REBUILT if the bytes must change?" — and for the migration that
// second question is the one that decides whether a lane is tractable. So the same
// tarball walk also COUNTS the two files a rebuild needs: `grammar.js` (or
// grammar.json / grammar.ts) and `parser.c`. A redistributor collection carries
// neither — measured on tree-sitter-wasms@0.1.11: 0 grammar.js, 0 parser.c, 34
// prebuilt wasms and a build script with nothing to run it on — so it is identifiable
// as sourceless in one pass, by evidence, rather than by assertion.
//
// `tar`'s exit code is still ignored, and the lesson from the first version stands:
// it exits non-zero on these archives while extracting them perfectly. The evidence
// is the extracted tree, not the tool's opinion.
type SourceEvidence = {
  /** A grammar definition a build could start from. */
  grammarSource: string[]
  /** A generated parser — present in a normal published grammar, absent from a pure binary redistribution. */
  parserC: string[]
  totalFiles: number
  /** A rebuild is possible from this tarball alone. */
  rebuildable?: boolean
}

// A BUILD LEAVES ITS OUTPUT FILENAME IN THE MODULE, and that is a second, independent
// provenance channel — one that still works when the bytes match nothing published, which
// is exactly the case a hash sweep cannot help with.
//
// IT IS CALIBRATED, which is the only reason it is recorded at all. Three shipped wasms
// name a version in their bytes, and all three agree with a version independently declared
// in an analyzer doc: `sql` -> tree-sitter-sql-0.3.11 (doc: @derekstride 0.3.11),
// `clean` -> tree-sitter-clean-127 (1.2.7), `perl` -> tree-sitter-perl-npm-1.2.1 (1.2.1).
// Three for three.
//
// IT IS A LEAD, NOT AN IDENTITY. A name says what somebody called the artefact when they
// compiled it. For a published package that is the package's own filename; for a local
// build it is whatever the person building it typed — `tree-sitter-bash-new.wasm` and
// `tree-sitter-svelte-new.wasm` are somebody's rebuild of the same grammar under a
// scratch name. So a non-standard name is evidence that the artefact is a LOCAL OR FORK
// build, which is a real finding, and it is not evidence of which upstream it came from.
// Reporting one as the other is the same error as reporting a size near-miss as a match.
const BUILD_NAME_RE = /[A-Za-z0-9._-]*tree-sitter[A-Za-z0-9._-]*\.wasm/g
function buildOutputNames(file: string): { shipped: string; named: string[]; isStandardName: boolean } {
  const shipped = path.basename(file)
  let text: string
  try {
    text = readFileSync(file).toString("latin1")
  } catch {
    return { shipped, named: [], isStandardName: true }
  }
  const named = [...new Set(text.match(BUILD_NAME_RE) ?? [])].sort()
  return { shipped, named, isStandardName: named.length === 0 || named.includes(shipped) }
}

function wasmFromTarball(pkg: string, version: string): { file: string; bytes: number; sha256: string; source: SourceEvidence } | null {
  const dir = mkdtempSync(path.join(tmpdir(), "bb-prov-"))
  const extract = mkdtempSync(path.join(tmpdir(), "bb-prov-x-"))
  try {
    if (!sh("npm", ["pack", `${pkg}@${version}`, "--pack-destination", dir], dir)) return null
    const tgz = readdirSync(dir).filter((f) => f.endsWith(".tgz"))
    if (!tgz.length) return null
    sh("tar", ["xzf", path.join(dir, tgz[0]), "-C", extract]) // exit code deliberately ignored
    let found: { file: string; bytes: number; sha256: string } | null = null
    const source: SourceEvidence = { grammarSource: [], parserC: [], totalFiles: 0 }
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { walk(p); continue }
        source.totalFiles++
        if (/^grammar\.(js|json|ts|mjs|cjs)$/.test(e.name)) source.grammarSource.push(e.name)
        else if (e.name === "parser.c") source.parserC.push(e.name)
        else if (e.name.endsWith(".wasm") && !found) {
          const b = readFileSync(p)
          found = { file: e.name, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") }
        }
      }
    }
    walk(extract)
    if (!found) return null
    source.rebuildable = source.grammarSource.length > 0 && source.parserC.length > 0
    return { ...found, source }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(extract, { recursive: true, force: true })
  }
}

type LaneResult = Record<string, any>
const results: LaneResult[] = []
process.stderr.write("  indexing redistributor collections (one download each)...\n")
const COLL = collectionIndex()
process.stderr.write(`  collection index: ${COLL.bySha.size} distinct wasm sha256\n`)
for (const [k, v] of [...COLL.source].sort()) {
  process.stderr.write(`    ${k}: ${v.grammarSource.length} grammar source file(s), ${v.parserC.length} parser.c, ${v.totalFiles} file(s) total -> ${v.rebuildable ? "REBUILDABLE from this tarball" : "NO REBUILDABLE SOURCE"}\n`)
}

// `--lanes a,b,c` scopes the census to a named set. The full sweep is ~30 minutes of
// npm traffic, and most callers want a subset: the migration pre-flight needs the 12
// real lanes, not the 7 orphaned wasms that no lane declares. Scoping here — rather
// than by filtering the artifact afterwards — keeps the artifact a record of what was
// actually searched, so "no match" still means "searched, and found nothing".
const LANES_ARG = (() => {
  const i = process.argv.indexOf("--lanes")
  return i >= 0 ? new Set((process.argv[i + 1] ?? "").split(",").map((x) => x.trim()).filter(Boolean)) : null
})()
if (LANES_ARG) progress(`scoped to ${LANES_ARG.size} named lane(s): ${[...LANES_ARG].join(", ")}`)

const targets = LANES_ARG
  ? survey.rows.filter((r: any) => LANES_ARG.has(r.lane))
  : ONLY
    ? survey.rows.filter((r: any) => r.lane === ONLY)
    : survey.rows.filter((r: any) => ALL || !r.declared.versionKnown)

// The build-output name is read from the SHIPPED bytes for every target, whether or not a
// published artifact matches — it is the only channel that still says something when nothing
// matches, which is precisely the 7 lanes this census cannot otherwise explain.
const BUILD_OUTPUT = new Map<string, ReturnType<typeof buildOutputNames>>()
for (const row of targets as any[]) {
  if (!row.shipped?.present) continue
  BUILD_OUTPUT.set(row.lane, buildOutputNames(path.join(WASM_DIR, row.shipped.file)))
}

for (const row of targets as any[]) {
  // An ALIAS inherits its primary's provenance: `scss` and `sass` are served by
  // tree-sitter-css and `terraform` by tree-sitter-hcl. Probing them separately
  // re-answers the same question three times and reports the primary's grammar as
  // "no match" against each alias, which reads as three broken lanes rather than one.
  if (row.aliasOf) {
    results.push({ lane: row.lane, status: "alias", aliasOf: row.aliasOf, reason: `alias of ${row.aliasOf}; shares that lane's grammar and its provenance` })
    continue
  }
  if (!row.shipped?.present) {
    results.push({ lane: row.lane, status: "no-artifact", reason: "lane ships no wasm (generic or alias)" })
    continue
  }
  const shippedSha = row.shipped.sha256 as string
  const shippedBytes = row.shipped.bytes as number
  const asset = String(row.wasmChain?.[0] ?? row.engineAsset ?? "")
  // The chain is `<package>/<file>.wasm` for some lanes and a BARE RELATIVE PATH for
  // others, and taking everything before `.wasm` on the latter produced the nonsense
  // package name `wasm/tree-sitter-hcl`, which npm then 404s on. Take the basename and
  // accept it only if it actually looks like a grammar name.
  const raw = asset.includes("/") ? asset.slice(asset.lastIndexOf("/") + 1) : asset
  const candidate = raw.replace(/\.wasm$/, "")
  // `row.lane`, not `lane`: the loop variable is `row` and there is no `lane` in scope. The
// typechecker found this, and it is a LIVE crash rather than a cosmetic slip — the fallback
// only evaluates when a chain asset is a bare single word (`dart.wasm` -> `dart`, which
// fails the pattern), so every such lane died with a ReferenceError while every
// hyphenated lane sailed past. Nothing in the runtime tests covered that branch.
const assetBase = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(candidate) ? candidate : `tree-sitter-${row.lane}`

  const packages = new Set<string>()
  if (PACKAGE_ALIASES[assetBase]) for (const p of PACKAGE_ALIASES[assetBase]) packages.add(p)
  else packages.add(assetBase)
  // The survey's candidate list can carry a BARE RELATIVE PATH as a package name
  // (`wasm/tree-sitter-hcl`, from a chain that is not `<pkg>/<file>.wasm`), which npm
  // 404s on. An npm package name never starts with `wasm/`, and never contains a `/`
  // except as a leading scope.
  for (const c of row.candidates ?? []) {
    const p = c.package
    if (!p) continue
    if (/^wasm\//.test(p)) continue
    if (p.includes("/") && !/^@[^/]+\/[^/]+$/.test(p)) continue
    packages.add(p)
  }
  // The REDISTRIBUTOR COLLECTION goes FIRST, and that ordering is the whole lesson of
  // this instrument's first run. `tree-sitter-wasms` ships prebuilt wasms for 36
  // grammars, and 12 of the 46 we load are byte-identical to its 0.1.13 build —
  // including SEVEN of the eighteen unversioned lanes (html, java, json, toml, tsx,
  // vue, zig). A probe that only asks each language's own npm package finds almost
  // nothing here and reports "no match", which reads as a finding rather than as the
  // blind spot it is. Provenance for a vendored grammar is TWO-dimensional: which
  // collection built these bytes, and which grammar version it was built against.
  // the collection is consulted through COLL.bySha below, not packed per lane

  process.stderr.write(`  ${row.lane.padEnd(13)} `)
  let match: LaneResult | null = null
  const leads: Array<Record<string, unknown>> = []
  let examined = 0

  // Collection first, from the ONE-TIME index — no download on this path at all. The
  // first version re-packed the 36-wasm collection for every lane, and the run was
  // still going after nine minutes; the collection is the same bytes for every lane, so
  // it is fetched once and matched against all of them.
  const coll = COLL.bySha.get(shippedSha)
  if (coll) {
    const slash = coll.lastIndexOf("/")
    const pkgAndV = coll.slice(0, slash)
    const at = pkgAndV.lastIndexOf("@")
    match = {
      package: pkgAndV.slice(0, at),
      version: pkgAndV.slice(at + 1),
      provenanceKind: "redistributor-collection",
      source: COLL.source.get(`${pkgAndV.slice(0, at)}@${pkgAndV.slice(at + 1)}`) ?? { grammarSource: [], parserC: [], totalFiles: 0, rebuildable: false },
      wasmFile: coll.slice(slash + 1),
      bytes: shippedBytes,
      sha256: shippedSha,
      note: "these bytes are a REDISTRIBUTOR BUILD. The collection version is exact; the underlying grammar version is not stated by the collection and must not be inferred from it.",
    }
    examined++
  }
  // GitHub release assets, via each package's own declared repository.
  if (!match) {
    for (const pkg of packages) {
      const v = npmView(pkg)
      const repoSlug = normalizeRepo(v?.repository?.url ?? v?.repository ?? v?.homepage)
      if (!repoSlug) continue
      const assetStem = String(row.lane).replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")
      const idx = ghReleaseWasms(repoSlug, new RegExp(`(^|-)${assetStem}\\.wasm$`, "i"))
      const hit = idx.get(shippedSha)
      if (hit) {
        const slash = hit.lastIndexOf("/")
        const at = hit.lastIndexOf("@", slash)
        match = {
          package: hit.slice(0, at),
          version: hit.slice(at + 1, slash),
          provenanceKind: "github-release-asset",
          wasmFile: hit.slice(slash + 1),
          bytes: shippedBytes,
          sha256: shippedSha,
          note: "identified from a GitHub RELEASE ASSET, resolved through the npm package's declared repository rather than by guessing the repo from the grammar name.",
        }
        examined++
        break
      }
    }
  }
  for (const pkg of match ? [] : packages) {
    if (match) break
    const versionList = npmVersions(pkg).slice(0, MAX_VERSIONS)
    for (const v of versionList) {
      examined++
      const w = wasmFromTarball(pkg, v)
      if (!w) continue
      if (w.sha256 === shippedSha) {
        match = { package: pkg, version: v, provenanceKind: "language-package", wasmFile: w.file, bytes: w.bytes, sha256: w.sha256, source: w.source }
        break
      }
      // A near-miss on size is a LEAD, never a match. Reporting it as a match is the one
      // thing this instrument must never do.
      if (Math.abs(w.bytes - shippedBytes) / Math.max(w.bytes, shippedBytes) < 0.02) {
        leads.push({ package: pkg, version: v, bytes: w.bytes, byteDelta: w.bytes - shippedBytes, sha256: w.sha256 })
      }
    }
  }

  progress(`  ${row.lane}: ${match ? `IDENTIFIED ${match.package}@${match.version}` : "no match"} (${examined} version(s) examined)`)
  results.push(
    match
      ? { lane: row.lane, status: "identified", ...match, shippedBytes, versionsExamined: examined, buildOutput: BUILD_OUTPUT.get(row.lane) }
      : {
          lane: row.lane,
          status: "no-match",
          shippedSha256: shippedSha,
          shippedBytes,
          packagesTried: [...packages],
          versionsExamined: examined,
          // The one channel that still says something when no hash matched. Calibrated
          // 3/3 against versions independently declared in analyzer docs (sql 0.3.11,
          // clean 1.2.7, perl 1.2.1) — and a LEAD, not an identity: a name says what
          // somebody called the artefact, which for `tree-sitter-bash-new.wasm` is a
          // scratch name for a rebuild of the same grammar.
          buildOutput: BUILD_OUTPUT.get(row.lane),
          leads: leads.sort((a, b) => Math.abs(a.byteDelta as number) - Math.abs(b.byteDelta as number)).slice(0, 3),
          conclusion:
            "No published artifact matches these bytes. The shipped wasm is therefore a LOCAL build, a fork, a vendored prebuild, or a redistributor's package — and its version cannot be recovered by hash. That is a finding, not a dead end: it must be recorded as `local build of unrecorded provenance`, and the source has to be found by reading the analyzer doc and the vendored grammar rather than by matching bytes.",
        },
  )
  process.stderr.write(`${match ? `IDENTIFIED ${(match as any).package}@${(match as any).version}` : "no match"}\n`)
}

const identified = results.filter((r) => r.status === "identified")
const unmatched = results.filter((r) => r.status === "no-match")

const report = {
  schemaVersion: 1,
  instrument: "m60-find-grammar-provenance",
  question: "which published artifact are the bytes we ship?",
  method:
    "For each lane with no declared version, derive candidate npm packages from the engine's own grammar asset plus a declared alias table, walk that package's versions newest-first, and compare the sha256 of the extracted .wasm against the bytes the product loads. A version is reported ONLY on an exact sha256 match. A same-size artifact is recorded as a lead and never as a match.",
  limits: [
    "Identifies against the PUBLISHED artifact only. A wasm that is a local build of a published version will not match, and is reported as `no-match` — correctly, because its bytes are not upstream's.",
    "A version window of --max-versions (default 6) is walked per package. A lane pinned to something older than that reports no-match rather than a false negative being read as an absence.",
    "Reads no declaration site and writes none. Recording an answer is a separate, human act in the analyzer's `Parser:` line, so a measurement can never quietly become a claim.",
  ],
  counts: { examined: results.length, identified: identified.length, noMatch: unmatched.length },
  identified: identified.map((r) => ({ lane: r.lane, package: r.package, version: r.version, provenanceKind: r.provenanceKind ?? null, sha256: r.sha256 })),
  noMatch: unmatched.map((r) => ({ lane: r.lane, packagesTried: r.packagesTried, leads: r.leads })),
  results,
}

mkdirSync(path.dirname(OUT), { recursive: true })

// PER-LANE RUNS ACCUMULATE, THEY DO NOT REPLACE. Re-running one lane used to overwrite the
// whole artifact with that lane alone, which is how `r` ended up with no census row at all —
// and the rebuild instrument, which takes its FIRST candidate from this census, then started
// from the survey's search-derived guess (`tree-sitter-r`, a 2022 security placeholder with no
// grammar.js) instead of the sha256-measured base. A measurement that silently loses earlier
// measurements is worse than no measurement, because the gap is invisible: the file is there,
// it parses, and the lane is simply absent.
let priorResults: any[] = []
if (existsSync(OUT)) {
  try {
    priorResults = JSON.parse(readFileSync(OUT, "utf8")).results ?? []
  } catch {
    priorResults = []
  }
}
const byLane = new Map<string, any>(priorResults.map((r) => [r.lane, r]))
for (const r of results) byLane.set(r.lane, r)
const merged = [...byLane.values()].sort((a, b) => String(a.lane).localeCompare(String(b.lane)))
const identified2 = merged.filter((r) => r.status === "identified")
const unmatched2 = merged.filter((r) => r.status !== "identified")
writeFileSync(
  OUT,
  JSON.stringify(
    {
      ...report,
      results: merged,
      counts: { examined: merged.length, identified: identified2.length, noMatch: unmatched2.length },
      identified: identified2.map((r) => ({ lane: r.lane, package: r.package, version: r.version, provenanceKind: r.provenanceKind })),
      noMatch: unmatched2.map((r) => ({ lane: r.lane, packagesTried: r.packagesTried, leads: r.leads, buildOutput: r.buildOutput })),
      mergedWithPriorRun: priorResults.length > 0,
      mergedLaneCount: merged.length,
    },
    null,
    2,
  ) + "\n",
)

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`\ngrammar provenance — ${report.counts.examined} lane(s): ${report.counts.identified} identified, ${report.counts.noMatch} unmatched\n`)
  for (const r of results) {
    if (r.status === "identified") console.log(`  ${r.lane.padEnd(13)} ${r.package}@${r.version}${(r.provenanceKind ?? "").includes("collection") ? "  [COLLECTION BUILD]" : ""}   sha ${r.sha256.slice(0, 16)}…  (${r.versionsExamined} version(s) examined)`)
    else if (r.status === "no-match") console.log(`  ${r.lane.padEnd(13)} NO MATCH over ${r.packagesTried.join(", ")} — ${r.versionsExamined} version(s) examined; ${r.leads.length} size-lead(s)`)
    else console.log(`  ${r.lane.padEnd(13)} ${r.reason}`)
  }
  console.log(`\n  written to ${path.relative(ROOT, OUT)}`)
  console.log(`  ${report.counts.identified} of these become \`Parser:\` lines; the ${report.counts.noMatch} unmatched need their source read, not a hash.`)
}
