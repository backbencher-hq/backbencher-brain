/**
 * CLOJURE LANE — THE PRICE OF THE `packageScope` CLAIM, MEASURED BEFORE IT IS PROPOSED.
 *
 * ## WHAT THIS IS
 *
 * The D7 wall table dispositions a 2,006-row class as **INSTRUMENT GAP** — *"a per-file analyzer
 * cannot know whether `babashka.*`, `rewrite-clj.*` is a project or an external module; no
 * clojure module-space fact exists"*. The fleet's own answer to that sentence already exists and
 * is not lane-specific: the `packageScope` claim (2026-10-20) states *"this target is a member of
 * the DEPENDENCY named `package`, and this project declares that dependency"*, and the evidence is
 * **the PROJECT'S OWN MANIFEST** — so a name from a dependency the project does not declare cannot
 * be claimed, and the checkout can refute it.
 *
 * **Clojure's manifest is `deps.edn` (tools.deps) or `project.clj` (Leiningen), and the shared
 * arbiter reads NEITHER.** The gate's `manifestDependenciesIn` reads go.mod, package.json,
 * composer.json, pubspec.yaml, Cargo.toml, pyproject.toml, requirements*.txt, Gemfile, pom.xml,
 * build.gradle(.kts), Package.swift and *.csproj — twelve kinds, and Clojure's two are not among
 * them. So the claim is STRUCTURALLY UNAVAILABLE to this lane, and no amount of lane work moves a
 * row until the arbiter reads the manifest.
 *
 * ## WHAT THIS INSTRUMENT MEASURES
 *
 * For every non-resolved edge whose target names a `<namespace>/<member>` pair where the namespace
 * is a THIRD-PARTY one the file itself declares, it asks the arbiter's OWN verifier
 * (`verifyPackageScopeClaim`) what the claim would do, against a manifest set read the way the
 * gate would read it — and reports the three answers that matter:
 *
 *   WOULD VERIFY     the project declares the dependency → the row becomes a VERIFIED external
 *                    claim (extOK). THE LEVER.
 *   WOULD REFUTE     the project does NOT declare it → the claim is FALSE and the row is counted
 *                    as a DEFECT (extFAIL). THE FALSIFIER, and it must be 0.
 *   NO MANIFEST      the file has no governing manifest → the claim is UNVERIFIABLE (ext?), which
 *                    is not a resolution. The gate's own fail-closed rule.
 *
 * ## THE SPELLING PROBLEM, STATED BECAUSE IT IS THE WHOLE PROPOSAL
 *
 * A Clojure libspec is written `babashka.fs` (one segment) or `io.replikativ/datalog-parser`
 * (group/artifact), and the MANIFEST writes the coordinate `babashka/fs`. The arbiter's matcher
 * (`verifyPackageScopeClaim`) is EXACT or `/`-boundary — it does not know that `.` and `/` are the
 * same separator here. So the reader must record BOTH spellings, and this instrument measures the
 * reader's output rather than assuming it.
 *
 * ## USAGE
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run validation/m14/fixtures/clojure/package-scope-price.ts [--json out.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { assertReaderParity, governingManifest, REPO_ROOT } from "./clojure-manifest-facts"
import { classifyEdge, externalClaimOf, isContainsEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = "clj,cljs,cljc,edn"
const JSON_OUT = (() => { const i = process.argv.indexOf("--json"); return i >= 0 ? process.argv[i + 1] ?? null : null })()
/** THE CONTROL. The Lead's ruling (2026-10-20) makes the `packageScope` claim's verification
 *  SEMANTICS a shared-instrument change: a package the manifest does not declare is UNVERIFIABLE,
 *  not REFUTED. That ruling must not LOOSEN anything, and this instrument is what proves it:
 *  the 629/977 split is computed HERE, from a lane-local manifest reader and the arbiter's own
 *  matcher, and it does NOT depend on the arbiter's semantics at all. So after the Lead's two
 *  changes land, the arm's movement must be EXACTLY the 629 verified rows and the 977 must still
 *  not resolve — and if the arm moves by more than 629, this control's expectation is what says so.
 *
 *  `--expect-verify N --expect-refute N` turns the two numbers into an assertion (exit 4 on a
 *  mismatch) so the control is a GATE and not a report. */
const EXPECT_VERIFY = (() => { const i = process.argv.indexOf("--expect-verify"); return i >= 0 ? Number(process.argv[i + 1]) : null })()
const EXPECT_REFUTE = (() => { const i = process.argv.indexOf("--expect-refute"); return i >= 0 ? Number(process.argv[i + 1]) : null })()

/** THE CLOSED LANGUAGE SET — the roots the `languageNamespace` claim already covers. A row whose
 *  namespace root is in this set is already claimed by that mechanism, so it is NOT part of this
 *  lever. */
const LANGUAGE_ROOTS = ["clojure", "cljs", "js", "goog", "java", "javax"]

function discover(): { files: string[]; repos: number; absent: number; overCap: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], repos: 0, absent: 0, overCap: 0 } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!EXTS.split(",").some((x) => rel.toLowerCase().endsWith(`.${x}`))) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
      } catch { absent++; continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return { files: found, repos: repos.size, absent, overCap }
}

/**
 * THE CLOJURE MANIFEST READER — what the gate's `manifestDependenciesIn` would have to add.
 *
 * `deps.edn` (tools.deps): `:deps {group/artifact {...}}` — a coordinate map.
 * `project.clj` (Leiningen): `:dependencies [[artifact "version"] [group/artifact "version"]]`.
 *
 * Each coordinate `g/a` is recorded in FOUR spellings, because a Clojure libspec may be written
 * any of them:
 *   `g/a`            the coordinate itself (a file may write the coordinate as its libspec)
 *   `g.a`            the group-with-a-dot form (a file may write the one-segment-group libspec)
 *   `<last(g)>.a`    the Clojure NAMESPACE convention (`org.clojure/tools.reader` -> `clojure.tools.reader`)
 *   `a`              the artifact alone (a file may write the artifact as its libspec)
 */
assertReaderParity(REPO_ROOT)

const disc = discover()
console.error(`population: ${disc.files.length} admitted files across ${disc.repos} repos (excluded ${disc.absent} absent + ${disc.overCap} over the 1 MB cap)`)

const repoOf = (f: string): string => (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0]!
const repoRoot = (repo: string): string => path.join(CR, repo)

/** THE GOVERNING MANIFEST FOR EACH FILE — the nearest ancestor, the gate's rule. The `clojure`
 *  repository carries a `pom.xml` and no `deps.edn`, so its files are governed by a MAVEN
 *  manifest, and a libspec on one of those files is unverifiable rather than verified. */
const manifests = new Map<string, Set<string>>()
for (const f of disc.files) {
  const repo = repoOf(f)
  const set = governingManifest(repoRoot(repo), f)
  manifests.set(f, set ?? new Set<string>())
}

type Rel = { type: string; target: string; file: string; line: number; metadata: Record<string, any> }
/** THE LIBSPECS EACH FILE DECLARES — the analyzer's own `imports` edges, whose target IS the
 *  dependency's spelling as the file wrote it (`babashka.fs`, `io.replikativ/datalog-parser`). */
const libspecs = new Map<string, Set<string>>()
const declCount = new Map<string, Map<string, number>>()
const declKinds = new Map<string, Map<string, Set<string>>>()
const relsByRepo = new Map<string, Rel[]>()
let parsed = 0
let failed = 0

for (const f of disc.files) {
  const repo = repoOf(f)
  let r: any
  try { r = await parseFile(f, repoRoot(repo)) } catch { failed++; continue }
  parsed++
  const dc = declCount.get(repo) ?? new Map<string, number>()
  const dk = declKinds.get(repo) ?? new Map<string, Set<string>>()
  for (const s of r?.symbols ?? []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    dc.set(name, (dc.get(name) ?? 0) + 1)
    const k = dk.get(name) ?? new Set<string>()
    k.add(kind)
    dk.set(name, k)
    // THE QUALIFIED-NAME ALIAS GOES INTO THE SAME KEY SPACE. The gate's own `countKey` is called
    // for the symbol's NAME and for its `qualifiedName`, so ONE map holds both spellings of one
    // declaration — and `classifyEdge` looks the target up in THAT map. An instrument that keeps
    // the alias in a second map hands the rule a key space the gate never sees, and every
    // qualified target reads unresolved: a false wall of thousands of rows, produced by the
    // instrument and not by the analyzer. (Measured here: 3,905 `clj-kondo.test-utils/*` calls
    // read unresolved under a split key space and are RESOLVED under the gate's.)
    const q = typeof (s as any).qualifiedName === "string" ? (s as any).qualifiedName : ""
    if (q && q !== name) {
      dc.set(q, (dc.get(q) ?? 0) + 1)
      const kq = dk.get(q) ?? new Set<string>()
      kq.add(kind)
      dk.set(q, kq)
    }
  }
  declCount.set(repo, dc)
  declKinds.set(repo, dk)
  const list = relsByRepo.get(repo) ?? []
  const libs = libspecs.get(f) ?? new Set<string>()
  for (const rel of r?.relationships ?? []) {
    const t = String(rel.type)
    const tgt0 = String(rel.target ?? "")
    if (t === "imports") libs.add(tgt0)
    list.push({ type: t, target: tgt0, file: f, line: Number(rel.line_number ?? 0), metadata: (rel.metadata ?? {}) as any })
  }
  libspecs.set(f, libs)
  relsByRepo.set(repo, list)
}
console.error(`parsed ${parsed} files (${failed} failures)`)

/** The arbiter's own matcher, used verbatim so the price is the arbiter's price. */
function claimVerdict(deps: Set<string>, pkg: string): "verified" | "refuted" {
  const want = pkg.trim().toLowerCase()
  if (want.length === 0) return "refuted"
  for (const d of deps) {
    const norm = d.trim().toLowerCase()
    if (norm.length === 0) continue
    if (norm === want) return "verified"
    if (norm.startsWith(want + "/") || want.startsWith(norm + "/")) return "verified"
  }
  return "refuted"
}

const rows: Array<{ type: string; target: string; file: string; line: number; pkg: string; verdict: "verified" | "refuted" | "no-manifest"; root: string }> = []
let totalNonResolved = 0
let alreadyClaimed = 0
let thirdPartyQualified = 0

for (const [repo, list] of relsByRepo) {
  const dc = declCount.get(repo) ?? new Map<string, number>()
  const dk = declKinds.get(repo) ?? new Map<string, Set<string>>()
  for (const rel of list) {
    const deps = manifests.get(rel.file) ?? new Set<string>()
    const tgt = rel.target
    // THE COUNTERFACTUAL, NOT THE CHANGE. The analyzer's own `packageScope` claim (once the
    // emission lands) is STRIPPED before the row is classified, so the instrument measures what the
    // claim WOULD do against the manifest rather than what the change already did. Without the
    // strip, the rows would be classified with the claim in hand and the counterfactual would be
    // measuring itself.
    const mdNoPkg = { ...rel.metadata }
    delete mdNoPkg.packageScope
    const claim = externalClaimOf({ type: rel.type, target: tgt, metadata: mdNoPkg })
    const c = classifyEdge(dc, dk, tgt, claim, undefined, isContainsEdge(rel.type), undefined, undefined, rel.file)
    if (c.outcome === "resolved") continue
    totalNonResolved++
    if (claim !== null) { alreadyClaimed++; continue }
    // THE PACKAGE CANDIDATE. A Clojure libspec is the DEPENDENCY'S OWN SPELLING, and the analyzer
    // publishes it twice: as the `imports` edge's target (the libspec as written) and, for an
    // ALIASED use, as the namespace part of a `<libspec>/<member>` call target. So a candidate is
    // the target's namespace part when the target is qualified, and the target itself when it is
    // not — and in BOTH cases it is only a candidate when the FILE ITSELF declares that libspec.
    // A target the file does not require is not this file's dependency, whatever the manifest says.
    const slash = tgt.indexOf("/")
    const ns = slash > 0 ? tgt.slice(0, slash) : tgt
    if (!libspecs.get(rel.file)?.has(ns)) continue
    const root = ns.split(".")[0]!
    if (LANGUAGE_ROOTS.includes(root)) continue
    thirdPartyQualified++
    const verdict = deps.size === 0 ? "no-manifest" : claimVerdict(deps, ns)
    rows.push({ type: rel.type, target: tgt, file: rel.file, line: rel.line, pkg: ns, verdict, root })
  }
}

const verified = rows.filter((r) => r.verdict === "verified")
const refuted = rows.filter((r) => r.verdict === "refuted")
const noManifest = rows.filter((r) => r.verdict === "no-manifest")
const byType = new Map<string, number>()
for (const r of verified) byType.set(r.type, (byType.get(r.type) ?? 0) + 1)
const byPkg = new Map<string, number>()
for (const r of verified) byPkg.set(r.pkg, (byPkg.get(r.pkg) ?? 0) + 1)
const refutedByPkg = new Map<string, number>()
for (const r of refuted) refutedByPkg.set(r.pkg, (refutedByPkg.get(r.pkg) ?? 0) + 1)

console.log("=== CLOJURE — THE PRICE OF THE `packageScope` CLAIM (measured BEFORE it is proposed) ===")
console.log(`root: ${CR}`)
console.log(`population: ${disc.files.length} admitted files / ${disc.repos} repos · parsed ${parsed} · failed ${failed}`)
console.log("")
console.log(`non-resolved edges                       ${totalNonResolved}`)
console.log(`  already carrying a claim               ${alreadyClaimed}`)
console.log(`  third-party QUALIFIED targets          ${thirdPartyQualified}   (a \`<ns>/<member>\` target whose namespace root is not in the language set)`)
console.log("")
console.log(`  WOULD VERIFY (the project declares it) ${verified.length}   <- the lever: unresolved -> a VERIFIED external claim`)
console.log(`  WOULD REFUTE (it does not)             ${refuted.length}   <- the falsifier: MUST be 0, or the rule is wrong`)
console.log(`  NO GOVERNING MANIFEST                  ${noManifest.length}   <- unverifiable, not a resolution`)
console.log("")
console.log(`  by label (verified): ${JSON.stringify(Object.fromEntries([...byType.entries()].sort((a, b) => b[1] - a[1])))}`)
console.log("")
console.log("  TOP VERIFIED PACKAGES:")
for (const [k, v] of [...byPkg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`    ${String(v).padStart(5)}  ${k}`)
console.log("")
console.log("  TOP REFUTED PACKAGES (these would be CLAUSE-4 failures if the claim were published blind):")
for (const [k, v] of [...refutedByPkg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`    ${String(v).padStart(5)}  ${k}`)

const controlOK =
  (EXPECT_VERIFY === null || EXPECT_VERIFY === verified.length) &&
  (EXPECT_REFUTE === null || EXPECT_REFUTE === refuted.length)
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    control: { expectVerify: EXPECT_VERIFY, expectRefute: EXPECT_REFUTE, gotVerify: verified.length, gotRefute: refuted.length, ok: controlOK },
    population: { root: CR, files: disc.files.length, repos: disc.repos, parsed, failed },
    totals: { nonResolved: totalNonResolved, alreadyClaimed, thirdPartyQualified, wouldVerify: verified.length, wouldRefute: refuted.length, noManifest: noManifest.length },
    byType: Object.fromEntries(byType),
    verifiedPackages: Object.fromEntries([...byPkg.entries()].sort((a, b) => b[1] - a[1])),
    refutedPackages: Object.fromEntries([...refutedByPkg.entries()].sort((a, b) => b[1] - a[1])),
    rows: rows.map((r) => ({ ...r, file: r.file })),
  }, null, 2) + "\n")
}
if (!controlOK) {
  console.error(`*** CONTROL FAILED: the 629/977 split moved (verify ${verified.length}, refute ${refuted.length}). The claim's emission surface changed — that is a finding, not a pass. ***`)
  process.exit(4)
}
if (EXPECT_VERIFY !== null) console.log(`CONTROL: verify ${verified.length} (expected ${EXPECT_VERIFY}) · refute ${refuted.length} (expected ${EXPECT_REFUTE}) — the emission surface is unchanged.`)
