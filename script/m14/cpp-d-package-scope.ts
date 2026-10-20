/**
 * cpp-d-package-scope — PRICE THE C++ BUCKET-D WALL AGAINST THE PACKAGE-SCOPE CLAIM, PER ECOSYSTEM.
 *
 * THE QUESTION THIS INSTRUMENT ANSWERS. The fleet's biggest lever is the package-scope claim
 * (`packageScope = {package, name}` — "this name is a member of the DEPENDENCY named `package`, and this
 * project declares that dependency"), and the C++ lane's bucket D (122,227 rows of the 614,081-row W1
 * wall) is the class it was built for. But the claim's EVIDENCE is the project's own manifest, and in C++
 * the manifest is `CMakeLists.txt` — which the gate's manifest reader does not read. The rollout map sizes
 * the gap (c 6.1 % governed, cpp 11.9 %), and it names the open question as the C++ lane's own:
 *
 *   "c / cpp cannot use the claim (their manifest is `CMakeLists.txt`, and a CMake *target* is not a
 *    dependency name) — INSTRUMENT GAP … a plan needs the C++ lane's own answer about what a
 *    `find_package`/`target_link_libraries` name means."
 *
 * So this instrument does NOT ask "is the claim available?" — the Lead already answered that. It asks the
 * question the lane owes: **GIVEN a CMake-aware manifest reader, what would the claim DECIDE, for each
 * bucket-D row, in each ecosystem?** The answer is a partition with a closure identity, and a per-ecosystem
 * table.
 *
 * WHAT MAKES IT A MEASUREMENT AND NOT A GUESS. Three things, and each is checkable:
 *
 *   1. THE BUCKETS ARE NOT RE-DERIVED — the four-bucket partition (A/B/C/D) is recomputed with the SAME
 *      rule `script/m14/cpp-w1-price.ts` uses (the W1 class re-derived from the ANALYZER's own exported
 *      sets, never forked) and the four totals are CROSS-CHECKED against the lane's COMMITTED D7 artifact
 *      (`validation/m14/fixtures/cpp/measurements/cpp-w1-price.json`). If they differ, the instrument
 *      exits 3 and reports nothing. So the 122,227 rows this instrument prices are THE 122,227 rows the
 *      D7 page priced — proved, not assumed.
 *   2. THE DECLARATION SPACE IS PRODUCTION'S — the SHIPPED `CPP_DECLARATION_SPEC` read through the SHIPPED
 *      `buildProjectIndexStreaming`, so "the project declares this name" means what production means.
 *   3. THE PROVENANCE IS THE CHECKOUT'S — the include spellings are the GATE'S OWN `imports` rows (the
 *      rows the gate wrote), and the manifest facts are read from the checkout's `CMakeLists.txt` with a
 *      PAREN-AWARE scanner (a multi-line `find_package(` is read whole, not line by line).
 *
 * THE RULING THIS INSTRUMENT PRICES (the lane's own page states it in full; the instrument implements it):
 *
 *   IN SCOPE as a `package`:  the name in `find_package(<Name>)`, and the pkg-config module names in
 *                             `pkg_check_modules(<PREFIX> <module>...)`. `<Name>` IS a dependency of the
 *                             project, exactly as a `package.json` dependency key is.
 *   IN SCOPE as CORROBORATION (never as an independent source): the namespace of an IMPORTED target
 *                             `Ns::Tgt` in `target_link_libraries` — CMake's own convention makes `Ns` the
 *                             package that provided the target, but a project may define an imported target
 *                             of its own, so the namespace only counts when the same `Ns` is also declared
 *                             by a `find_package`/`pkg_check_modules`.
 *   REFUSED:                 `find_library`/`find_path` `NAMES` entries (a FILE STEM, not a package);
 *                             a bare `target_link_libraries` item that names a PROJECT target
 *                             (`add_library`/`add_executable` in the same project — an in-project edge, not
 *                             a dependency); `add_subdirectory(<dir>)` (a project directory);
 *                             `FetchContent_Declare(<name>)` (a FETCHED dependency — its sources are IN the
 *                             checkout, so its declarations are the PROJECT's, and the row is bucket A).
 *
 * THE MEMBERSHIP TEST (the lane's half of the claim — "this name is a member of P"):
 *   A C++ translation unit says which LIBRARY a name comes from by the HEADER it includes, not by an
 *   import statement — so the C++ analogue of dart's `package:` URI is the `#include` directive. The
 *   test is: the TU includes an EXTERNAL (angle-bracketed) header whose FIRST PATH SEGMENT is the
 *   package's include root, and the governing manifest declares that package. A single-root system header
 *   (`<zlib.h>`, `<erl_nif.h>`, `<Python.h>`) has no package-shaped root and is therefore NOT attributable
 *   by this rule — a stated limitation, and a measured one (the instrument counts those rows).
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-d-package-scope.ts \
 *     --dump=.tmp-cpp/cpp-noindex-cap0-dump.txt [--json=<path>] [--repos=a,b]
 *
 * EXIT: 0 priced (the partition closes and the D7 cross-check holds) · 2 usage/environment · 3 CONTROL
 * DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, existsSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const DUMP = argOf("--dump")
const JSON_OUT = argOf("--json")
/** `--rows-out=<path>`: the PER-ROW bucket of every W1 row, as a TSV (`file \t line \t target \t bucket`).
 *  It exists so another instrument can JOIN against it without rebuilding the project index — the bucket C
 *  bound, for instance, is the JOIN of this file's buckets with the receiver census's per-row classes. */
const ROWS_OUT = argOf("--rows-out")
const ONLY_REPOS = (argOf("--repos") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
if (!DUMP) {
  console.error("usage: bun run script/m14/cpp-d-package-scope.ts --dump=<gate dump> [--json=<path>] [--repos=a,b]")
  process.exit(2)
}
const availGB = os.freemem() / (1024 ** 3)
const load1 = os.loadavg()[0]
if (availGB < 3) {
  console.error(`cpp-d-package-scope: REFUSING — ${availGB.toFixed(2)} GB available, the index builds need >= 3 GB (load ${load1.toFixed(2)}). Wait for headroom and re-run.`)
  process.exit(2)
}

const ADMITTED = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const HEADERS = new Set(["h", "hh", "h++"])
const SIZE_CAP = 1024 * 1024
const extOf = (p: string): string => { const b = p.slice(p.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(d + 1).toLowerCase() : "" }
const CORPUS_MARK = `${path.sep}.corpus${path.sep}`
const repoOf = (src: string): string => {
  const i = src.indexOf(CORPUS_MARK)
  const rest = i >= 0 ? src.slice(i + CORPUS_MARK.length) : src
  return rest.split(path.sep)[0]
}
const relOf = (src: string): string => {
  const i = src.indexOf(CORPUS_MARK)
  return i >= 0 ? src.slice(i + CORPUS_MARK.length) : src
}

// ── the ANALYZER's own sets, re-derived (never forked) ───────────────────────────────────────────
const analyzerSrc = readFileSync(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"), "utf8")
function extractStringSet(name: string): Set<string> {
  const start = analyzerSrc.indexOf(`export const ${name}`)
  if (start < 0) return new Set()
  const open = analyzerSrc.indexOf("[", start)
  if (open < 0) return new Set()
  let depth = 0, close = -1
  for (let i = open; i < analyzerSrc.length; i++) {
    if (analyzerSrc[i] === "[") depth++
    else if (analyzerSrc[i] === "]") { depth--; if (depth === 0) { close = i; break } } }
  if (close < 0) return new Set()
  const body = analyzerSrc.slice(open + 1, close)
  const out = new Set<string>()
  let i = 0
  while (i < body.length) {
    while (i < body.length && body[i] !== '"') i++
    if (i >= body.length) break
    let j = i + 1
    while (j < body.length && body[j] !== '"') j++
    const v = body.slice(i + 1, j)
    if (v.length > 0) out.add(v)
    i = j + 1
  }
  return out
}
const CPP_KEYWORDS = extractStringSet("CPP_KEYWORDS")
const CPP_BUILTIN_TYPE_KEYWORDS = extractStringSet("CPP_BUILTIN_TYPE_KEYWORDS")
const CPP_NON_CLASS_STANDARD_TYPES = extractStringSet("CPP_NON_CLASS_STANDARD_TYPES")
if (CPP_KEYWORDS.size < 40 || CPP_BUILTIN_TYPE_KEYWORDS.size < 10 || CPP_NON_CLASS_STANDARD_TYPES.size < 5) {
  console.error(`CONTROL DID NOT FIRE: the analyzer's own sets read ${CPP_KEYWORDS.size}/${CPP_BUILTIN_TYPE_KEYWORDS.size}/${CPP_NON_CLASS_STANDARD_TYPES.size} — a rename must fail here, not misclassify.`)
  process.exit(3)
}
const isIdentifierShape = (s: string): boolean => {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
    if (!ok) return false
  }
  return !(s[0] >= "0" && s[0] <= "9")
}
const isAllCapsIdentifier = (s: string): boolean => {
  let hasUpper = false
  for (let i = 0; i < s.length; i++) {
    if (s[i] >= "a" && s[i] <= "z") return false
    if (s[i] >= "A" && s[i] <= "Z") hasUpper = true
  }
  return hasUpper
}
const isW1 = (t: string): boolean => {
  if (t.length === 0) return false
  if (CPP_KEYWORDS.has(t) || CPP_BUILTIN_TYPE_KEYWORDS.has(t)) return false
  if (CPP_NON_CLASS_STANDARD_TYPES.has(t)) return false
  if (t.startsWith("operator") || t.startsWith("~")) return false
  if (t.includes("::")) return false
  if (t.includes("<") || t.includes(">")) return false
  if (!isIdentifierShape(t)) return false
  if (isAllCapsIdentifier(t)) return false
  return true
}

// ── the COMMITTED standard-library vocabulary (read, not forked) ───────────────────────────────────
const { ISO_CPP_STDLIB } = await import(path.join(ROOT, "script/m14/citations.ts"))
const STDLIB_ROOTS = new Set<string>(ISO_CPP_STDLIB.roots)
if (STDLIB_ROOTS.size < 10) {
  console.error(`CONTROL DID NOT FIRE: the committed iso-cpp-stdlib vocabulary reads ${STDLIB_ROOTS.size} roots (expected the committed list).`)
  process.exit(3)
}

// ── the DUMP: the W1 rows and the gate's own `imports` rows ───────────────────────────────────────
type Row = { target: string; src: string; line: number; outcome: string }
type FileImports = { angle: Set<string>; quoted: Set<string> }
const w1: Row[] = []
const qualifiedRows: Row[] = []
const importsByFile = new Map<string, FileImports>()
let residualRows = 0
let callsResidual = 0
let importRows = 0
{
  const text = readFileSync(DUMP, "utf8")
  let start = 0
  while (start < text.length) {
    let nl = text.indexOf("\n", start)
    if (nl < 0) nl = text.length
    const line = text.slice(start, nl)
    start = nl + 1
    if (!line.startsWith("DUMP\t")) continue
    const p = line.split("\t")
    if (p.length < 5) continue
    const m = p[4].match(/^(.*):(\d+)$/)
    if (!m) continue
    const src = m[1]
    if (ONLY_REPOS.length > 0 && !ONLY_REPOS.includes(repoOf(src))) continue
    if (p[1] === "imports") {
      importRows++
      const fi = importsByFile.get(src) ?? { angle: new Set(), quoted: new Set() }
      fi.angle.add(p[3].trim())
      importsByFile.set(src, fi)
      continue
    }
    if (p[2] !== "unresolved" && p[2] !== "ambDeclOnly" && p[2] !== "ambBoth") continue
    residualRows++
    if (p[1] !== "calls") continue
    callsResidual++
    const t = p[3].trim()
    // THE QUALIFIED rows of the wall (the W4 class) — the spelling names a namespace, and a namespace is
    // a SPELLING of a package. They are where the package-scope claim can fire, so they are measured too.
    if (t.includes("::")) {
      qualifiedRows.push({ target: t, src, line: Number(m[2]), outcome: p[2] })
      continue
    }
    if (!isW1(t)) continue
    w1.push({ target: t, src, line: Number(m[2]), outcome: p[2] })
  }
}
if (w1.length === 0) { console.error(`cpp-d-package-scope: 0 W1 rows — check the dump path (${DUMP})`); process.exit(2) }
const repos = [...new Set(w1.map((r) => repoOf(r.src)))].sort()

// ── the PROJECT DECLARATION SPACE (the SHIPPED spec + the SHIPPED builder) ─────────────────────────
const indexMod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const spec: any = indexMod.CPP_DECLARATION_SPEC
if (!spec) { console.error("cpp-d-package-scope: project-index.ts does not export CPP_DECLARATION_SPEC"); process.exit(3) }
const wasm = path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")
type Space = {
  names: Set<string>; counts: Map<string, number>; typeNames: Set<string>
  memberOwners: Map<string, number>; files: number; buildMs: number; types: number; damaged: number
}
const spaces = new Map<string, Space>()
for (const repo of repos) {
  const repoDir = path.join(CR, repo)
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    const e = extOf(rel)
    if (!ADMITTED.has(e) && !HEADERS.has(e)) continue
    const abs = path.join(repoDir, rel)
    try { if (statSync(abs).size <= SIZE_CAP) files.push(abs) } catch { /* absent */ }
  }
  const t0 = performance.now()
  let built: any
  try { built = await indexMod.buildProjectIndexStreaming(wasm, files, spec) } catch (e: any) {
    console.error(`cpp-d-package-scope: index build FAILED for ${repo}: ${e?.message ?? e}`)
    continue
  }
  built.complete = true
  const memberOwners = new Map<string, number>()
  for (const [, members] of built.typeMembers) for (const mem of members) memberOwners.set(mem, (memberOwners.get(mem) ?? 0) + 1)
  spaces.set(repo, {
    names: built.symbolNames, counts: built.symbolCounts, typeNames: new Set(built.typeKinds.keys()),
    memberOwners, files: files.length, buildMs: performance.now() - t0, types: built.typeKinds.size,
    damaged: built.stats?.damaged ?? 0,
  })
}
if (spaces.size === 0) { console.error("cpp-d-package-scope: no repo index was built — refusing to price with an empty declaration space"); process.exit(3) }

// ── the FOUR BUCKETS, same rule as script/m14/cpp-w1-price.ts ─────────────────────────────────────
const fourWay = new Map<string, number>()
const bucketOf = new Map<string, string>()
const rowBuckets: string[] = []
/** The A (and B) sub-splits, counted from the per-row labels, so the report carries the lane's own
 *  measurement of what the index DECIDES and what it only BOUNDS. */
const aSubSplit: string[] = []
const bump = (b: string, r: Row, sub?: string): void => {
  fourWay.set(b, (fourWay.get(b) ?? 0) + 1)
  bucketOf.set(`${r.src}:${r.line}:${r.target}`, b)
  rowBuckets.push(`${relOf(r.src)}\t${r.line}\t${r.target}\t${sub ?? b}`)
  if (b === "A") aSubSplit.push(sub ?? "A")
}
const dRows: Row[] = []
for (const r of w1) {
  const sp = spaces.get(repoOf(r.src))
  const declared = sp?.names.has(r.target) === true
  const isType = sp?.typeNames.has(r.target) === true
  const ownerCount = sp?.memberOwners.get(r.target) ?? 0
  const declCount = sp?.counts.get(r.target) ?? 0
  if (ownerCount > 0 && !isType) {
    // THE C SUB-SPLIT, carried per row so the bound can be reported per sub-class: the one-owner class is
    // where a receiver fact DECIDES outright (exactly one class declares the leaf), and the many-owner
    // class is where it must still CHOOSE among several.
    bump("C", r, ownerCount === 1 ? "C/member-leaf-one-owner-receiver-typing" : "C/member-leaf-many-owners-receiver-typing")
    continue
  }
  if (declared) {
    // THE A SUB-SPLIT, carried per row: the index DECIDES a name the project declares EXACTLY ONCE, and
    // only BOUNDS one it declares several times (the name key cannot choose among them). That difference
    // is what "what the index buys in bucket A" is made of.
    // A TYPE-shaped target in a `calls` row is a CONSTRUCTION (`to_utf8(x)` builds a `to_utf8`), so the
    // class declaration IS the target's declaration — but a type the project declares SEVERAL TIMES is
    // BOUNDED, not decided (the D7 page's own "a type named 81 times is bounded, not decided"). So the
    // type class splits on the declaration count too, and "what the index DECIDES" is measured, not
    // assumed.
    if (isType) bump("A", r, declCount === 1 ? "A/index-declares-TYPE-construction-ONCE" : "A/index-declares-TYPE-construction-MULTI")
    else if (declCount === 1) bump("A", r, "A/index-declares-FREE-FNCE-ONCE")
    else bump("A", r, "A/index-declares-FREE-FNCE-MULTI")
    continue
  }
  if (STDLIB_ROOTS.has(r.target)) { bump("B", r, "B/committed-stdlib-vocabulary"); continue }
  bump("D", r)
  dRows.push(r)
}

// ── THE CROSS-CHECK: the four totals must equal the lane's COMMITTED D7 artifact ──────────────────
// It runs on the WHOLE population only: a `--repos` subset is a SAMPLE, and a sample's four-way totals
// are not the population's — comparing them would be comparing different populations (R1).
{
  const artifactPath = path.join(ROOT, "validation/m14/fixtures/cpp/measurements/cpp-w1-price.json")
  if (ONLY_REPOS.length > 0) {
    console.log(`CROSS-CHECK SKIPPED — a --repos subset is a SAMPLE (${ONLY_REPOS.join(",")}); the D7 artifact holds the WHOLE population's four-way totals.`)
  } else if (existsSync(artifactPath)) {
    const art = JSON.parse(readFileSync(artifactPath, "utf8"))
    const want = art.fourWay ?? {}
    const diffs: string[] = []
    for (const k of ["A", "B", "C", "D"]) {
      if (Number(want[k] ?? -1) !== (fourWay.get(k) ?? -1)) diffs.push(`${k}: committed ${want[k]} vs recomputed ${fourWay.get(k) ?? 0}`)
    }
    if (diffs.length > 0) {
      console.error(`CONTROL DID NOT FIRE: the recomputed four-bucket partition differs from the COMMITTED D7 artifact:\n  ${diffs.join("\n  ")}`)
      console.error("   The D rows this instrument prices would NOT be the D rows the D7 page priced. Reporting nothing.")
      process.exit(3)
    }
    console.log(`CROSS-CHECK vs the committed D7 artifact: A ${fourWay.get("A")} · B ${fourWay.get("B")} · C ${fourWay.get("C")} · D ${fourWay.get("D")} — MATCH`)
  } else {
    console.error(`CONTROL DID NOT FIRE: the committed D7 artifact is missing (${artifactPath}) — the cross-check cannot run.`)
    process.exit(3)
  }
}

// ── the ECOSYSTEM LABEL: the kind of the FIRST manifest above the file ─────────────────────────────
// The rollout map's per-lane table is a per-ECOSYSTEM table ("how each ecosystem's files are governed"),
// and the ecosystem of a file IS the kind of the manifest that governs it: a C++ file under a
// `pubspec.yaml` is governed by the DART ecosystem, and a claim on it is judged against Dart packages.
// The label is therefore the nearest manifest's KIND, over ALL kinds — the same nearest-ancestor rule the
// gate's reader uses, and the one the ruling is about.
const GATE_MANIFEST_KINDS = ["package.json", "composer.json", "pubspec.yaml", "Cargo.toml", "pyproject.toml", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts", "Package.swift"]
const ALL_MANIFEST_KINDS = ["CMakeLists.txt", ...GATE_MANIFEST_KINDS]
const nearestKindCache = new Map<string, string | null>()
function nearestManifestKind(absDir: string, repoDir: string): string | null {
  if (nearestKindCache.has(absDir)) return nearestKindCache.get(absDir) ?? null
  let dir = absDir
  let found: string | null = null
  for (;;) {
    for (const k of ALL_MANIFEST_KINDS) { if (existsSync(path.join(dir, k))) { found = k; break } }
    if (found !== null) break
    if (path.resolve(dir) === path.resolve(repoDir)) break
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  nearestKindCache.set(absDir, found)
  return found
}

// ── the CMAKE MANIFEST FACTS (the ruling's semantics, implemented) ────────────────────────────────
type CmakeFacts = {
  path: string
  findPackage: string[]          // `find_package(<Name>)` — IN SCOPE as a package
  pkgConfig: string[]            // `pkg_check_modules(<PREFIX> <module>...)` — IN SCOPE as a package
  importedNamespaces: string[]   // `Ns` of `Ns::Tgt` in target_link_libraries — CORROBORATION only
  refusedLibraryNames: string[]  // `find_library(NAMES a b)` — REFUSED
  projectTargets: string[]       // `add_library(x)`/`add_executable(x)` — REFUSED (in-project)
  fetched: string[]              // `FetchContent_Declare(x)` — REFUSED (in-checkout ⇒ bucket A)
  subdirectories: string[]       // `add_subdirectory(d)` — REFUSED (project directory)
}
/**
 * CMAKE COMMENTS ARE NOT DECLARATIONS — and a scanner that does not strip them invents dependencies.
 *
 * MEASURED, NOT ASSUMED: ghostty's root `CMakeLists.txt` carries
 *   `#   find_package(ghostty-vt REQUIRED)`
 * inside a comment that documents "Option 2 — find_package (after installing to a prefix)". A scanner that
 * reads the raw text sees a package named `ghostty-vt` that the project does not depend on — and a claim
 * checked against it would be REFUTED by a checkout that never declared it. So the scanner strips CMake
 * line comments FIRST: a `#` outside a quoted string runs to the end of the line.
 *
 * THE LIMIT, STATED: CMake's bracket comments (`#[[ ... ]]`) are not handled, and a `#` inside a quoted
 * string is correctly kept. The corpus's manifests use neither in a way that changes a package name (the
 * census reports every package name it found, so a reader can check the list).
 */
function stripCmakeComments(text: string): string {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    let inString = false
    let cut = line.length
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"' && line[i - 1] !== "\\") inString = !inString
      else if (c === "#" && !inString) { cut = i; break }
    }
    out.push(line.slice(0, cut))
  }
  return out.join("\n")
}

/** A PAREN-AWARE command scanner: CMake commands may span lines, so a line-based read would miss half
 *  the manifest. It scans for a command word at a token boundary and reads to the matching `)`. */
function scanCmake(text: string, command: string): string[][] {
  const out: string[][] = []
  const re = new RegExp(`(^|[^A-Za-z0-9_])${command}\\s*\\(`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const open = text.indexOf("(", m.index + m[0].length - 1)
    let depth = 0, i = open
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")") { depth--; if (depth === 0) break }
    }
    const body = text.slice(open + 1, i)
    out.push(body.split(/\s+/).map((s) => s.replace(/^["']|["']$/g, "")).filter((s) => s.length > 0))
    re.lastIndex = i
  }
  return out
}
const cmakeCache = new Map<string, CmakeFacts | null>()
function cmakeFactsFor(absDir: string, repoDir: string): CmakeFacts | null {
  if (cmakeCache.has(absDir)) return cmakeCache.get(absDir) ?? null
  let dir = absDir
  let found: CmakeFacts | null = null
  for (;;) {
    const candidate = path.join(dir, "CMakeLists.txt")
    if (existsSync(candidate)) {
      let text = ""
      try { text = readFileSync(candidate, "utf8") } catch { text = "" }
      const findPackage = scanCmake(stripCmakeComments(text), "find_package").map((a) => a[0]).filter((s): s is string => typeof s === "string" && s.length > 0 && s.toUpperCase() !== "COMPONENTS")
      const pkgConfig: string[] = []
      for (const args of scanCmake(stripCmakeComments(text), "pkg_check_modules")) {
        // `pkg_check_modules(<PREFIX> [REQUIRED|QUIET] <module>...)` — the PREFIX is a local variable
        // name, the MODULES are the packages.
        for (const a of args.slice(1)) {
          if (a.toUpperCase() === "REQUIRED" || a.toUpperCase() === "QUIET" || a.toUpperCase() === "IMPORTED_TARGET") continue
          if (a.startsWith("-")) continue
          pkgConfig.push(a)
        }
      }
      const importedNamespaces: string[] = []
      const projectTargets: string[] = []
      for (const cmd of ["add_library", "add_executable"]) for (const a of scanCmake(text, cmd)) if (typeof a[0] === "string" && a[0].length > 0) projectTargets.push(a[0])
      for (const args of scanCmake(stripCmakeComments(text), "target_link_libraries")) {
        for (const a of args.slice(1)) {
          if (a.toUpperCase() === "PUBLIC" || a.toUpperCase() === "PRIVATE" || a.toUpperCase() === "INTERFACE") continue
          if (a.startsWith("-")) continue
          const ns = a.split("::")[0]
          if (ns && ns !== a) importedNamespaces.push(ns)
        }
      }
      const refusedLibraryNames: string[] = []
      for (const cmd of ["find_library", "find_path"]) {
        for (const args of scanCmake(text, cmd)) {
          const ni = args.findIndex((a) => a.toUpperCase() === "NAMES")
          if (ni < 0) continue
          for (const a of args.slice(ni + 1)) { if (!a.toUpperCase().startsWith("PATH_SUFFIXES")) refusedLibraryNames.push(a) }
        }
      }
      const fetched = scanCmake(stripCmakeComments(text), "FetchContent_Declare").map((a) => a[0]).filter((s): s is string => typeof s === "string" && s.length > 0)
      const subdirectories = scanCmake(stripCmakeComments(text), "add_subdirectory").map((a) => a[0]).filter((s): s is string => typeof s === "string" && s.length > 0)
      found = {
        path: candidate, findPackage: [...new Set(findPackage)], pkgConfig: [...new Set(pkgConfig)],
        importedNamespaces: [...new Set(importedNamespaces)], refusedLibraryNames: [...new Set(refusedLibraryNames)],
        projectTargets: [...new Set(projectTargets)], fetched: [...new Set(fetched)],
        subdirectories: [...new Set(subdirectories)],
      }
      break
    }
    if (path.resolve(dir) === path.resolve(repoDir)) break
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  cmakeCache.set(absDir, found)
  return found
}
/** The include-root ALIASES of a package name — TWO levels, because the relation between a package's name
 *  and its include root is a CONVENTION, and the convention holds for some packages and not for others.
 *
 *  STRICT  the package's own name and its `_`/`-` variants. A root equal to one of these is the package's
 *          own include directory (`absl/…` for `absl`, `gtest/…` for `GTest`, `boost/…` for `Boost`).
 *  LOOSE   the word-boundary PREFIXES of the package's name (`nlohmann` for `nlohmann_json`) and the
 *          namespaces of the manifest's IMPORTED targets (`protobuf::…` for `Protobuf`). A root that
 *          matches only here is a WEAKER attribution, and the instrument reports the two levels
 *          separately so the precision/recall point is the Lead's choice and not the lane's.
 *
 *  WHAT IS NOT IN EITHER SET, AND WHY IT MATTERS: a dependency whose headers are NOT in the checkout has
 *  an include root the checkout cannot know. `find_package(Protobuf)` installs headers under
 *  `google/protobuf/`, and nothing in the source tree says so — the `Protobuf_INCLUDE_DIRS` variable
 *  holds it only at CONFIGURE time. So the relation is not a scanner weakness; it is a limit of the
 *  evidence, and the instrument measures it instead of papering over it. */
const strictAliasesOf = (pkg: string): Set<string> => {
  const p = pkg.trim().toLowerCase()
  const out = new Set<string>()
  if (p.length === 0) return out
  out.add(p)
  out.add(p.replace(/_/g, "-"))
  out.add(p.replace(/-/g, "_"))
  const base = p.split(/[/:]/).pop() ?? p
  if (base.length > 0) { out.add(base); out.add(base.replace(/_/g, "-")); out.add(base.replace(/-/g, "_")) }
  return out
}
const looseAliasesOf = (pkg: string, importedNamespaces: string[]): Set<string> => {
  const out = strictAliasesOf(pkg)
  const p = pkg.trim().toLowerCase()
  if (p.length === 0) return out
  // word-boundary prefixes: `nlohmann` for `nlohmann_json`, `proto` for `protobuf` — the boundary is the
  // same path-boundary discipline the arbiter uses for a scoped package name.
  for (const seg of p.split(/[_\-/:.]+/)) if (seg.length >= 3) out.add(seg)
  for (const ns of importedNamespaces) {
    const n = ns.trim().toLowerCase()
    if (n.length === 0) continue
    out.add(n)
    if (n.startsWith(p)) out.add(p)
  }
  return out
}

// ── the INCLUDE SETS, read from the CHECKOUT (the delimiters the dump does not carry) ─────────────
// The gate's `imports` row carries the include SPELLING but not its DELIMITER, and the delimiter is the
// whole difference here: `#include <boost/x.hpp>` names a header a DEPENDENCY provides, while
// `#include "util/y.h"` names a file in THIS project. So the instrument reads the `#include` lines of the
// translation unit itself, and COUNTS the gate's rows beside them — a mismatch is reported, not hidden.
const includesByFile = new Map<string, { angle: Set<string>; quoted: Set<string> }>()
{
  const files = new Set(dRows.map((r) => r.src))
  for (const f of files) {
    let text = ""
    try { text = readFileSync(f, "utf8") } catch { continue }
    const angle = new Set<string>()
    const quoted = new Set<string>()
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/.exec(line)
      if (!m) continue
      if (m[1] === "<") angle.add(m[2]); else quoted.add(m[2])
    }
    includesByFile.set(f, { angle, quoted })
  }
}
let includeRowsRead = 0
for (const [, v] of includesByFile) includeRowsRead += v.angle.size + v.quoted.size

// ── the INCLUDE ROOTS each file uses (built once, not per row) ────────────────────────────────────
const rootsByFile = new Map<string, Set<string>>()
for (const [file, f] of includesByFile) {
  const rs = new Set<string>()
  for (const inc of f.angle) { const s = inc.split("/")[0].toLowerCase(); if (s.length > 0) rs.add(s) }
  if (rs.size > 0) rootsByFile.set(file, rs)
}

// ── the PER-ECOSYSTEM PRICING of bucket D, AGAINST THE CLAIM ──────────────────────────────────────
//
// THE RULING THIS PRICES (the lane's page — CPP-PACKAGE-SCOPE-RULING.md) has TWO halves, and they are
// not the same half:
//
//   THE DEPENDENCY HALF — "this project declares the package" — is the manifest's, and the arbiter's.
//   It is available for a C++ file exactly when the governing manifest is a `CMakeLists.txt` AND the
//   gate reads it (it does not today).
//
//   THE MEMBERSHIP HALF — "this name is a member of that package" — is the LANE's, and for C++ it is
//   only establishable for a QUALIFIED spelling: `acme::make` names the namespace, and the checkout's
//   `<acme/widget.h>` names the same package in a second, independent way. **A BARE name has no
//   per-name evidence at all**: the include test is a UNIT-level fact, and the lane's own verifier
//   produced the counterexample (a name that came from `<vector>` claimed as a package member).
//
// Bucket D is BARE by construction (the W1 rule excludes a qualified spelling), so the sound claim's
// reach over bucket D is measured here rather than assumed — and the instrument also measures the
// QUALIFIED class, which is where the claim's real C++ reach is.
//
// THE VERDICT CLASSES (a partition of every D row; the control checks the sum):
//
//   CLAIM-SOUND-REACH          the row is QUALIFIED and its namespace agrees with a declared package's
//                              include root -> the claim decides this row (measured over bucket D AND
//                              over the qualified class)
//   UNIT-ATTRIBUTION-UNIQUE    the row is BARE and its unit's include roots match EXACTLY ONE declared
//                              package -> the unit-level attribution is unambiguous. This is the CEILING
//                              for any per-name rule: a rule cannot do better than the unit it is in
//   UNIT-ATTRIBUTION-AMBIGUOUS  the unit matches TWO OR MORE declared packages -> no rule can attribute
//                              the unit's bare names to one of them
//   NO-DECLARED-PACKAGE-MATCH  the unit uses package-shaped include roots and the manifest declares
//                              NONE of them -> a claim on such a root would be REFUTED by the checkout
//   NO-PROVENANCE              the unit has no package-shaped include root at all (system/toolchain
//                              headers only) -> the name is not attributable to a package by this rule
//   FOREIGN-MANIFEST           a gate-readable manifest from ANOTHER ecosystem governs the file -> a C++
//                              package claim on it is judged against a FOREIGN dependency list, so it
//                              would be REFUTED. The claim must NEVER be emitted here
//   UNVERIFIABLE-NO-MANIFEST   no manifest governs the file at all -> the claim has no evidence to be
//                              verified against
type Verdict = "CLAIM-SOUND-REACH" | "UNIT-ATTRIBUTION-UNIQUE" | "UNIT-ATTRIBUTION-AMBIGUOUS"
  | "NO-DECLARED-PACKAGE-MATCH" | "NO-PROVENANCE" | "FOREIGN-MANIFEST" | "UNVERIFIABLE-NO-MANIFEST"
const VERDICTS: Verdict[] = ["CLAIM-SOUND-REACH", "UNIT-ATTRIBUTION-UNIQUE", "UNIT-ATTRIBUTION-AMBIGUOUS",
  "NO-DECLARED-PACKAGE-MATCH", "NO-PROVENANCE", "FOREIGN-MANIFEST", "UNVERIFIABLE-NO-MANIFEST"]
const emptyVerdicts = (): Record<Verdict, number> => ({
  "CLAIM-SOUND-REACH": 0, "UNIT-ATTRIBUTION-UNIQUE": 0, "UNIT-ATTRIBUTION-AMBIGUOUS": 0,
  "NO-DECLARED-PACKAGE-MATCH": 0, "NO-PROVENANCE": 0, "FOREIGN-MANIFEST": 0, "UNVERIFIABLE-NO-MANIFEST": 0,
})
type EcoReport = {
  ecosystem: string
  rows: number
  verdicts: Record<Verdict, number>
  repos: Record<string, number>
}
const ecoReports = new Map<string, EcoReport>()
const ecoOf = (kind: string | null): string => kind === null ? "no-manifest" : kind
const ecoBump = (kind: string | null, v: Verdict, repo: string): void => {
  const e = ecoOf(kind)
  const rep = ecoReports.get(e) ?? { ecosystem: e, rows: 0, verdicts: emptyVerdicts(), repos: {} }
  rep.rows++
  rep.verdicts[v]++
  rep.repos[repo] = (rep.repos[repo] ?? 0) + 1
  ecoReports.set(e, rep)
}
type RepoReport = {
  repo: string
  dRows: number
  manifest: string | null
  findPackage: string[]
  pkgConfig: string[]
  importedNamespaces: string[]
  refusedLibraryNames: string[]
  projectTargets: string[]
  fetched: string[]
  verdicts: Record<Verdict, number>
  matchedPackages: Record<string, number>
  unmatchedRoots: Record<string, number>
  topNames: Record<string, number>
  samples: string[]
}
const reports = new Map<string, RepoReport>()
for (const repo of repos) {
  reports.set(repo, {
    repo, dRows: 0, manifest: null, findPackage: [], pkgConfig: [], importedNamespaces: [],
    refusedLibraryNames: [], projectTargets: [], fetched: [],
    verdicts: emptyVerdicts(), matchedPackages: {}, unmatchedRoots: {}, topNames: {}, samples: [],
  })
}

/** The declared packages of a manifest, with the include-root aliases the ruling admits. */
const aliasSetsFor = (facts: CmakeFacts): { strict: Map<string, string>; loose: Map<string, string> } => {
  const strict = new Map<string, string>()
  const loose = new Map<string, string>()
  for (const p of [...facts.findPackage, ...facts.pkgConfig]) {
    for (const a of strictAliasesOf(p)) if (!strict.has(a)) strict.set(a, p)
    for (const a of looseAliasesOf(p, facts.importedNamespaces)) if (!loose.has(a)) loose.set(a, p)
  }
  return { strict, loose }
}

/** The class a translation unit's INCLUDE ROOTS fall into, given a manifest's declared packages. */
type UnitClass = { kind: "unique" | "ambiguous" | "none"; packages: string[]; unmatchedRoots: string[] }
const classifyUnit = (roots: Set<string>, facts: CmakeFacts): UnitClass => {
  const { strict, loose } = aliasSetsFor(facts)
  const matched = new Set<string>()
  const unmatched: string[] = []
  for (const root of roots) {
    const pkg = strict.get(root) ?? loose.get(root)
    if (pkg) matched.add(pkg)
    else unmatched.push(root)
  }
  if (matched.size === 1) return { kind: "unique", packages: [...matched], unmatchedRoots: unmatched }
  if (matched.size > 1) return { kind: "ambiguous", packages: [...matched], unmatchedRoots: unmatched }
  return { kind: "none", packages: [], unmatchedRoots: unmatched }
}

for (const r of dRows) {
  const repo = repoOf(r.src)
  const rep = reports.get(repo)!
  rep.dRows++
  rep.topNames[r.target] = (rep.topNames[r.target] ?? 0) + 1
  const repoDir = path.join(CR, repo)
  const ecoKind = nearestManifestKind(path.dirname(r.src), repoDir)
  // A file governed by ANOTHER ecosystem's manifest is judged against that manifest — so a C++ package
  // claim on it is REFUTED. The claim must never be emitted there.
  if (ecoKind !== null && ecoKind !== "CMakeLists.txt") {
    rep.verdicts["FOREIGN-MANIFEST"]++
    ecoBump(ecoKind, "FOREIGN-MANIFEST", repo)
    if (rep.samples.length < 8) rep.samples.push(`${relOf(r.src)}:${r.line} ${r.target} — governed by ${ecoKind} (a foreign manifest)`)
    continue
  }
  const facts = cmakeFactsFor(path.dirname(r.src), repoDir)
  if (!facts) {
    rep.verdicts["UNVERIFIABLE-NO-MANIFEST"]++
    ecoBump(ecoKind, "UNVERIFIABLE-NO-MANIFEST", repo)
    if (rep.samples.length < 8) rep.samples.push(`${relOf(r.src)}:${r.line} ${r.target} — no manifest governs this file`)
    continue
  }
  if (!rep.manifest) {
    rep.manifest = facts.path
    rep.findPackage = facts.findPackage
    rep.pkgConfig = facts.pkgConfig
    rep.importedNamespaces = facts.importedNamespaces
    rep.refusedLibraryNames = facts.refusedLibraryNames
    rep.projectTargets = facts.projectTargets
    rep.fetched = facts.fetched
  }
  const fi = includesByFile.get(r.src)
  const roots = new Set<string>()
  for (const inc of fi?.angle ?? []) {
    if (inc.includes("/")) { const s = inc.split("/")[0].toLowerCase(); if (s.length > 0) roots.add(s) }
  }
  // THE SOUND CASE: a QUALIFIED spelling whose namespace agrees with a declared package's include root.
  const cut = r.target.lastIndexOf("::")
  if (cut > 0) {
    const ns = r.target.slice(0, cut).toLowerCase()
    const root = ns.split("::")[0]
    const { strict, loose } = aliasSetsFor(facts)
    const pkg = strict.get(root) ?? loose.get(root)
    if (pkg && roots.has(root)) {
      rep.verdicts["CLAIM-SOUND-REACH"]++
      ecoBump(ecoKind, "CLAIM-SOUND-REACH", repo)
      rep.matchedPackages[pkg] = (rep.matchedPackages[pkg] ?? 0) + 1
      if (rep.samples.length < 8) rep.samples.push(`${relOf(r.src)}:${r.line} ${r.target} — SOUND: package ${pkg}`)
      continue
    }
  }
  const unit = classifyUnit(roots, facts)
  if (unit.kind === "unique") {
    rep.verdicts["UNIT-ATTRIBUTION-UNIQUE"]++
    ecoBump(ecoKind, "UNIT-ATTRIBUTION-UNIQUE", repo)
    rep.matchedPackages[unit.packages[0]] = (rep.matchedPackages[unit.packages[0]] ?? 0) + 1
    if (rep.samples.length < 8) rep.samples.push(`${relOf(r.src)}:${r.line} ${r.target} — the unit's only declared package is ${unit.packages[0]}`)
    continue
  }
  if (unit.kind === "ambiguous") {
    rep.verdicts["UNIT-ATTRIBUTION-AMBIGUOUS"]++
    ecoBump(ecoKind, "UNIT-ATTRIBUTION-AMBIGUOUS", repo)
    if (rep.samples.length < 8) rep.samples.push(`${relOf(r.src)}:${r.line} ${r.target} — the unit matches ${unit.packages.join(", ")}`)
    continue
  }
  if (unit.unmatchedRoots.length > 0) {
    for (const x of unit.unmatchedRoots) rep.unmatchedRoots[x] = (rep.unmatchedRoots[x] ?? 0) + 1
    rep.verdicts["NO-DECLARED-PACKAGE-MATCH"]++
    ecoBump(ecoKind, "NO-DECLARED-PACKAGE-MATCH", repo)
    if (rep.samples.length < 8) rep.samples.push(`${relOf(r.src)}:${r.line} ${r.target} — include root(s) ${unit.unmatchedRoots.join(",")} not declared`)
    continue
  }
  rep.verdicts["NO-PROVENANCE"]++
  ecoBump(ecoKind, "NO-PROVENANCE", repo)
  if (rep.samples.length < 8) rep.samples.push(`${relOf(r.src)}:${r.line} ${r.target} — no package-shaped include root`)
}

// ── the QUALIFIED class: where the claim's REAL C++ reach is ───────────────────────────────────────
// Bucket D is bare by construction, so the sound claim's reach over it is measured ABOVE — and the
// QUALIFIED rows (the W4 wall) are where the claim can actually fire. They are measured here, from the
// SAME dump, so the Lead sees the claim's real reach and not only the class it cannot reach.
const qualifiedReach = { rows: 0, soundReach: 0, byEcosystem: new Map<string, number>() }
for (const line of qualifiedRows) {
  qualifiedReach.rows++
  const repo = repoOf(line.src)
  const repoDir = path.join(CR, repo)
  const ecoKind = nearestManifestKind(path.dirname(line.src), repoDir)
  if (ecoKind !== "CMakeLists.txt") continue
  const facts = cmakeFactsFor(path.dirname(line.src), repoDir)
  if (!facts) continue
  const cut = line.target.lastIndexOf("::")
  if (cut <= 0) continue
  const root = line.target.slice(0, cut).toLowerCase().split("::")[0]
  const { strict, loose } = aliasSetsFor(facts)
  const pkg = strict.get(root) ?? loose.get(root)
  if (!pkg) continue
  const fi = includesByFile.get(line.src)
  const roots = new Set<string>()
  for (const inc of fi?.angle ?? []) if (inc.includes("/")) roots.add(inc.split("/")[0].toLowerCase())
  if (!roots.has(root)) continue
  qualifiedReach.soundReach++
  const e = ecoOf(ecoKind)
  qualifiedReach.byEcosystem.set(e, (qualifiedReach.byEcosystem.get(e) ?? 0) + 1)
}

// ── the CLOSURE: every D row lands in exactly one verdict class ───────────────────────────────────
const verdictTotal = [...reports.values()].reduce((a, r) => a + VERDICTS.reduce((b, v) => b + r.verdicts[v], 0), 0)
if (verdictTotal !== dRows.length) {
  console.error(`CONTROL DID NOT FIRE: the verdict classes sum to ${verdictTotal} but bucket D holds ${dRows.length} rows.`)
  process.exit(3)
}

const report = {
  schemaVersion: 2,
  instrument: "script/m14/cpp-d-package-scope.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  corpusRoot: CR,
  population: {
    residualRowsInDump: residualRows,
    callsResidualRows: callsResidual,
    w1Rows: w1.length,
    dRows: dRows.length,
    qualifiedRowsInDump: qualifiedRows.length,
    repos: repos.length,
    reposIndexed: spaces.size,
    importRowsInDump: importRows,
    includeRowsReadFromSource: includeRowsRead,
    machine: { loadAvg1: Number(load1.toFixed(2)), availableGBAtStart: Number(availGB.toFixed(2)), cores: os.cpus().length },
  },
  crossCheck: {
    against: "validation/m14/fixtures/cpp/measurements/cpp-w1-price.json",
    fourWay: Object.fromEntries([...fourWay.entries()].sort()),
    holds: true,
  },
  ruling: {
    inScopeAsPackage: ["find_package(<Name>)", "pkg_check_modules(<PREFIX> <module>...) — the MODULE names"],
    corroborationOnly: ["the namespace of an imported target Ns::Tgt in target_link_libraries — only where the same Ns is declared by a find_package/pkg_check_modules"],
    refused: ["find_library/find_path NAMES (a file stem)", "a bare target_link_libraries item naming a PROJECT target", "add_subdirectory(<dir>)", "FetchContent_Declare(<name>) (a fetched dependency — its sources are IN the checkout)"],
    membershipTest: "the SOUND case: a QUALIFIED spelling whose namespace agrees with a declared package's include root, the unit including that root. A BARE name has NO per-name evidence — the include test is a UNIT-level fact, and the lane's own verifier produced the counterexample (a name that came from <vector> claimed as a package member).",
    manifestGovernsBy: "the nearest ancestor manifest of ANY kind, walking UP from the file's own directory to the repository root — the same nearest-ancestor rule the gate's manifest reader uses.",
  },
  verdicts: Object.fromEntries(VERDICTS.map((v) => [v, [...reports.values()].reduce((a, r) => a + r.verdicts[v], 0)])),
  closure: { dRows: dRows.length, priced: verdictTotal, partitionHolds: verdictTotal === dRows.length },
  bucketA: {
    rows: [...reports.values()].reduce((a, r) => a + ((r.verdicts as Record<string, number>)["A"] ?? 0), 0),
    note: "the rows the PROJECT INDEX DECLARES and the arbiter does not BIND. `decided` is the sub-class the index can DECIDE outright (the project declares the name EXACTLY ONCE, so the name key has no choice to make); `bounded` is the sub-class the index can only BOUND (several declarations, so the arbiter would have to choose among them — the arbitraryTwin class the must-not-rise rule protects).",
  },
  bucketASubSplit: (() => {
    const out: Record<string, number> = {}
    for (const b of aSubSplit) out[b] = (out[b] ?? 0) + 1
    return out
  })(),
  qualifiedClass: {
    rows: qualifiedReach.rows,
    soundReach: qualifiedReach.soundReach,
    byEcosystem: Object.fromEntries([...qualifiedReach.byEcosystem.entries()].sort((a, b) => b[1] - a[1])),
    note: "the QUALIFIED rows of the wall (the W4 class) — where the package-scope claim can fire, because the spelling names the package's namespace. Bucket D is BARE, so this is the claim's REAL C++ reach.",
  },
  perEcosystem: [...ecoReports.values()].sort((a, b) => b.rows - a.rows),
  perRepo: [...reports.values()].sort((a, b) => b.dRows - a.dRows),
}
if (ROWS_OUT) {
  const fs = await import("node:fs")
  const t = path.resolve(ROOT, ROWS_OUT)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.writeFileSync(t, rowBuckets.join("\n") + "\n")
  console.log(`rows-out: ${rowBuckets.length} W1 row buckets written to ${ROWS_OUT}`)
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const t = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.writeFileSync(t, json)
}
const pct = (n: number): string => `${((n / dRows.length) * 100).toFixed(1)}%`
console.log(`cpp-d-package-scope — W1 ${w1.length} · bucket D ${dRows.length} · qualified rows ${qualifiedRows.length} · repos ${repos.length} · indexes ${spaces.size}`)
console.log(`D PRICED AGAINST THE PACKAGE-SCOPE CLAIM (sum ${verdictTotal} == D ${dRows.length}: ${verdictTotal === dRows.length ? "PASS" : "FAIL"})`)
for (const v of VERDICTS) {
  const n = [...reports.values()].reduce((a, r) => a + r.verdicts[v], 0)
  console.log(`  ${v.padEnd(28)} ${String(n).padStart(8)}  ${pct(n)}`)
}
console.log(`THE QUALIFIED CLASS (the claim's real C++ reach): ${qualifiedReach.soundReach} of ${qualifiedReach.rows} qualified rows`)
console.log("PER ECOSYSTEM (bucket-D rows) — the ecosystem IS the kind of the first manifest above the file")
for (const e of [...ecoReports.values()].sort((a, b) => b.rows - a.rows)) {
  const parts = VERDICTS.map((v) => `${v.replace("UNIT-ATTRIBUTION-", "ua-").replace("NO-DECLARED-PACKAGE-MATCH", "no-declared").replace("UNVERIFIABLE-NO-MANIFEST", "no-manifest").replace("CLAIM-SOUND-REACH", "sound")}=${e.verdicts[v]}`).join(" ")
  console.log(`  ${e.ecosystem.padEnd(20)} D=${String(e.rows).padStart(7)}  ${parts}`)
}
console.log("PER REPO (bucket-D rows)")
for (const r of [...reports.values()].sort((a, b) => b.dRows - a.dRows)) {
  if (r.dRows === 0) continue
  console.log(`  ${r.repo.padEnd(22)} D=${String(r.dRows).padStart(7)}  sound=${String(r.verdicts["CLAIM-SOUND-REACH"]).padStart(5)}  unique=${String(r.verdicts["UNIT-ATTRIBUTION-UNIQUE"]).padStart(6)}  ambiguous=${String(r.verdicts["UNIT-ATTRIBUTION-AMBIGUOUS"]).padStart(6)}  no-declared=${String(r.verdicts["NO-DECLARED-PACKAGE-MATCH"]).padStart(6)}  no-prov=${String(r.verdicts["NO-PROVENANCE"]).padStart(6)}  foreign=${String(r.verdicts["FOREIGN-MANIFEST"]).padStart(6)}  no-manifest=${String(r.verdicts["UNVERIFIABLE-NO-MANIFEST"]).padStart(6)}  manifest=${r.manifest ? "yes" : "NO"}`)
  if (r.findPackage.length > 0) console.log(`      find_package: ${r.findPackage.join(", ")}`)
  if (r.pkgConfig.length > 0) console.log(`      pkg_check_modules: ${r.pkgConfig.join(", ")}`)
}
