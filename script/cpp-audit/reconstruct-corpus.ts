/**
 * RECONSTRUCT THE C++ WHOLE-POPULATION CORPUS — pinned, sparse, and re-runnable.
 *
 * THE GAP THIS CLOSES. Every whole-population number the cpp lane published (the D7 wall ledger's
 * 871,129 rows / 7,435 files / 31 repos, the 23,237-file closure, the W1 four-bucket partition) was
 * measured on an UNPINNED corpus at `$PWD/.corpus` — a fleet checkout that no longer exists on this
 * machine and whose repository list was never committed. The numbers could not be re-derived, and the
 * spec generator's measurement inputs were absent with them.
 *
 * WHAT IT DOES. Reconstructs a DOCUMENTED corpus from the two committed evidence sources, at their
 * pinned revisions, with a per-repository `pinState` that says whether the pin resolved:
 *
 *   1. `validation/m11/corpus-manifest.json` — the fleet's 31-repo scale corpus, full 40-char pins
 *      (the private `vscode` fork is the one remote that no longer exists; recorded as absent);
 *   2. `validation/m14/parse-success-baseline.json` — per-lane repo pins; every cpp-carrying repo
 *      that appears there and not in (1) is added at its recorded pin (fmt, nlohmann-json, duckdb,
 *      otp, ripgrep, jq, sqlite, zls);
 *   3. the cpp lane's own named corpora with NO recorded pin (Catch2, abseil-cpp, spdlog, googletest,
 *      Rcpp, protobuf) plus the two large header sources named in `cpp-h-routing.md` (dart-sdk,
 *      flutter-packages) — cloned at HEAD and the observed SHA recorded here, so the reconstruction
 *      is at least pinned from this moment forward.
 *
 * IT IS A RECONSTRUCTION, NOT THE ORIGINAL POPULATION, and every artifact it feeds must say so: the
 * original repo list is unrecoverable, so numbers re-derived on this corpus are comparable in SHAPE
 * (per-type resolution, wall partition, arms' deltas) but not claimed to reproduce the ledger's
 * counts. Clone is SPARSE (`*.cpp *.cc *.cxx *.c++ *.hpp *.hxx *.hh *.h *.ipp *.inl *.cu`) against a
 * `--filter=blob:none` fetch, so a 200k-file repository costs only its C++ blobs.
 *
 * USAGE
 *   bun run script/cpp-audit/reconstruct-corpus.ts [--root=<dir>] [--dry-run]
 * Writes `validation/cpp-audit/corpus-manifest.json` (the provenance every measurement cites).
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const argOf = (f: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`${f}=`))
  return hit ? hit.slice(f.length + 1) : null
}
// THE ROOT'S SHAPE IS LOAD-BEARING. The wall instruments derive a repository name as the path
// segment AFTER a literal `/.corpus/` marker (`repoOf` in cpp-wall-disposition / cpp-w1-price), and
// then join `BB_CORPUS_ROOT` with that name. So the reconstruction root must END in a directory
// literally named `.corpus` whose CHILDREN are the repositories — otherwise every row's repo
// collapses to one name and the per-project index spaces are built from the wrong directory.
const CORPUS_ROOT = argOf("--root") ?? path.join(ROOT, ".cpp-corpus", ".corpus")
const DRY = process.argv.includes("--dry-run")
const MANIFEST_OUT = path.join(ROOT, "validation", "cpp-audit", "corpus-manifest.json")
const EXT_PATTERNS = ["*.cpp", "*.cc", "*.cxx", "*.c++", "*.hpp", "*.hxx", "*.hh", "*.h", "*.ipp", "*.inl", "*.cu"]

/** The remote of every repo the parse-success baseline pins that is not in the M11 manifest. */
const PARSE_SUCCESS_REMOTES: Record<string, string> = {
  fmt: "https://github.com/fmtlib/fmt.git",
  "nlohmann-json": "https://github.com/nlohmann/json.git",
  duckdb: "https://github.com/duckdb/duckdb.git",
  otp: "https://github.com/erlang/otp.git",
  ripgrep: "https://github.com/BurntSushi/ripgrep.git",
  jq: "https://github.com/jqlang/jq.git",
  sqlite: "https://github.com/sqlite/sqlite.git",
  zls: "https://github.com/zigtools/zls.git",
}
/** The lane's own named corpora with no recorded revision in this checkout: cloned at HEAD and
 *  pinned by the observed SHA recorded in the manifest. */
const HEAD_REPOS: Record<string, string> = {
  Catch2: "https://github.com/catchorg/Catch2.git",
  "abseil-cpp": "https://github.com/abseil/abseil-cpp.git",
  spdlog: "https://github.com/gabime/spdlog.git",
  googletest: "https://github.com/google/googletest.git",
  Rcpp: "https://github.com/RcppCore/Rcpp.git",
  protobuf: "https://github.com/protocolbuffers/protobuf.git",
  "dart-sdk": "https://github.com/dart-lang/sdk.git",
  "flutter-packages": "https://github.com/flutter/packages.git",
}

interface RepoPlan {
  id: string
  remote: string
  requestedRevision: string | null
  source: "m11-manifest" | "parse-success-pin" | "head"
  pinState: "pinned" | "head" | "absent"
  note?: string
}

const m11 = JSON.parse(readFileSync(path.join(ROOT, "validation/m11/corpus-manifest.json"), "utf8"))
const parseSuccess = JSON.parse(readFileSync(path.join(ROOT, "validation/m14/parse-success-baseline.json"), "utf8"))
const headPins: Record<string, string> = {}
for (const lane of Object.values<any>(parseSuccess.lanes ?? {})) {
  const repo = String(lane?.repo ?? "")
  const pin = String(lane?.repoPin ?? "")
  if (repo && pin) headPins[repo] = pin
}

const plans: RepoPlan[] = []
for (const r of m11.repositories as any[]) {
  if (r.id === "vscode") {
    plans.push({ id: r.id, remote: r.remote, requestedRevision: r.revision, source: "m11-manifest", pinState: "absent", note: "the private fork's remote no longer exists (Repository not found); excluded and recorded rather than silently substituted" })
    continue
  }
  plans.push({ id: r.id, remote: r.remote, requestedRevision: r.revision, source: "m11-manifest", pinState: "pinned" })
}
const m11Ids = new Set(plans.map((p) => p.id))
for (const [id, remote] of Object.entries(PARSE_SUCCESS_REMOTES)) {
  if (m11Ids.has(id)) continue
  const pin = headPins[id]
  plans.push({ id, remote, requestedRevision: pin ?? null, source: pin ? "parse-success-pin" : "head", pinState: pin ? "pinned" : "head" })
}
for (const [id, remote] of Object.entries(HEAD_REPOS)) {
  if (m11Ids.has(id)) continue
  plans.push({ id, remote, requestedRevision: null, source: "head", pinState: "head" })
}

/** git, WITHOUT throwing: a fetch failure is data (the pin or the network), not a reason to abort a
 *  46-repo reconstruction half-way through. */
const gitTry = (dir: string, args: string[]): { ok: boolean; out: string; err: string } => {
  try {
    const out = execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })
    return { ok: true, out: out.trim(), err: "" }
  } catch (e: any) {
    return { ok: false, out: "", err: String(e?.stderr ?? e?.message ?? e).slice(0, 300) }
  }
}
/** A transient GitHub failure must not lose a repo: three attempts, spaced. */
const gitRetry = (dir: string, args: string[]): { ok: boolean; out: string; err: string } => {
  let last = { ok: false, out: "", err: "" }
  for (let i = 0; i < 3; i++) {
    last = gitTry(dir, args)
    if (last.ok) return last
    execFileSync("sleep", ["3"], { stdio: "ignore" })
  }
  return last
}

const manifest: any = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  instrument: "script/cpp-audit/reconstruct-corpus.ts",
  root: path.relative(ROOT, CORPUS_ROOT),
  populationRule:
    "per-repo sparse checkout of the C++ spellings (cpp,cc,cxx,c++,hpp,hxx,hh,h,ipp,inl,cu); the population a measurement sees is the files on disk under this root, discovered by the SAME git-ls-files rule the gate uses",
  NOTE: "RECONSTRUCTION. The original whole-population corpus was an unpinned fleet checkout whose repository list was never committed. This manifest is the documented stand-in: sources 1-2 are pinned by committed evidence, source 3 is pinned from its first clone. Numbers re-derived here are comparable in shape, not claimed to reproduce the original ledger's counts.",
  sources: {
    "m11-manifest": "validation/m11/corpus-manifest.json",
    "parse-success-pin": "validation/m14/parse-success-baseline.json",
    head: "no recorded revision in this checkout; observed SHA recorded below",
  },
  sparsePatterns: EXT_PATTERNS,
  repos: [] as any[],
  absent: [] as any[],
}

for (const plan of plans) {
  if (plan.pinState === "absent") {
    manifest.absent.push({ id: plan.id, remote: plan.remote, requestedRevision: plan.requestedRevision, reason: plan.note })
    continue
  }
  const dir = path.join(CORPUS_ROOT, plan.id)
  const repo: any = {
    id: plan.id,
    remote: plan.remote,
    source: plan.source,
    requestedRevision: plan.requestedRevision,
    pinState: plan.pinState,
  }
  if (DRY) {
    manifest.repos.push({ ...repo, observedRevision: null, status: "dry-run" })
    continue
  }
  // A directory left behind by an interrupted run counts as NOT cloned: the resume test is a real
  // HEAD, not the presence of a .git directory.
  const hasHead = existsSync(path.join(dir, ".git")) && gitTry(dir, ["rev-parse", "HEAD"]).ok
  if (!hasHead) {
    mkdirSync(dir, { recursive: true })
    if (!existsSync(path.join(dir, ".git"))) gitTry(dir, ["init", "-q"])
    const remotes = gitTry(dir, ["remote", "get-url", "origin"])
    if (!remotes.ok) gitTry(dir, ["remote", "add", "origin", plan.remote])
    const rev = plan.requestedRevision ?? "HEAD"
    let fetched = gitRetry(dir, ["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", rev])
    if (!fetched.ok && plan.requestedRevision) {
      // A pin that no longer resolves is FALLEN BACK to HEAD and SAID SO, never silently replaced.
      fetched = gitRetry(dir, ["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", "HEAD"])
      if (fetched.ok) {
        repo.pinState = "head"
        repo.pinFallbackReason = "requested pin did not resolve; HEAD fetched instead"
      }
    }
    if (!fetched.ok) {
      repo.status = "fetch-failed"
      repo.fetchError = fetched.err
      manifest.repos.push(repo)
      continue
    }
    const co = gitTry(dir, ["checkout", "-q", "FETCH_HEAD"])
    if (!co.ok) {
      repo.status = "checkout-failed"
      repo.checkoutError = co.err
      manifest.repos.push(repo)
      continue
    }
    gitTry(dir, ["sparse-checkout", "init", "--no-cone"])
    const sc = gitTry(dir, ["sparse-checkout", "set", "--no-cone", ...EXT_PATTERNS])
    if (!sc.ok) repo.sparseError = sc.err
  }
  repo.observedRevision = gitTry(dir, ["rev-parse", "HEAD"]).out
  const counts: Record<string, number> = {}
  for (const p of EXT_PATTERNS) {
    const ext = p.slice(1)
    const r = gitTry(dir, ["ls-files", p])
    counts[ext] = r.ok ? r.out.split("\n").filter(Boolean).length : 0
  }
  repo.trackedCppFiles = Object.values(counts).reduce((a, b) => a + b, 0)
  repo.counts = counts
  manifest.repos.push(repo)
}

const totalFiles = manifest.repos.reduce((a: number, r: any) => a + (r.trackedCppFiles ?? 0), 0)
const perExt: Record<string, number> = {}
for (const r of manifest.repos) for (const [e, n] of Object.entries(r.counts ?? {})) perExt[e] = (perExt[e] ?? 0) + Number(n)
manifest.population = {
  repos: manifest.repos.length,
  absentRepos: manifest.absent.length,
  pinned: manifest.repos.filter((r: any) => r.pinState === "pinned").length,
  headPinned: manifest.repos.filter((r: any) => r.pinState === "head").length,
  cppSpellingFiles: totalFiles,
  perExtension: perExt,
}
writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2) + "\n")
console.log(`reconstruct-corpus: ${manifest.population.repos} repos (${manifest.population.absentRepos} absent) · ${totalFiles} C++-spelling files`)
console.log(`  per extension: ${Object.entries(perExt).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e}:${n}`).join(" ")}`)
console.log(`  pinned ${manifest.population.pinned} · head-pinned ${manifest.population.headPinned} · manifest ${path.relative(ROOT, MANIFEST_OUT)}`)
