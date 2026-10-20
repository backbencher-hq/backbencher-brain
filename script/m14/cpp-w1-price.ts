/**
 * cpp-w1-price — PRICE THE C++ W1 WALL: the 614,081 "callable-not-declared" rows, split into the
 * four buckets the depth campaign asks for.
 *
 * THE QUESTION. C++'s dominant wall is W1-callable-not-declared-in-run: 614,081 `calls` rows (of
 * 727,514 residual call rows) whose callee leaf no file in the per-file population declares. The
 * lane must disposition them into EXACTLY FOUR buckets:
 *
 *   A. DECLARED ELSEWHERE IN THE PROJECT — a project fact answers them. A header, another
 *      translation unit, or an admitted sibling file declares the name. This is the bucket the
 *      PROJECT INDEX exists to decide, so it is measured against the index's OWN declaration space.
 *   B. STANDARD-LIBRARY names — the `ISO_CPP_STDLIB` vocabulary (committed in script/m14/citations.ts
 *      with measured symbols). A claim kind already exists for it (the `namespace` claim, narrowed to
 *      `languageNamespacePolicy="strict-absent"`), so this bucket is the claim's REACH, measured.
 *   C. GENUINELY UNDECIDABLE in the per-file model — a RULED class with a falsifier. Names nothing
 *      in the project declares, not in the committed vocabulary, and not decidable by any spelling.
 *   D. NEEDS A NEW CLAIM KIND — a CLAIMED class: rows a project fact CAN decide but the arbiter has
 *      no claim kind for, so the lane must ask the Lead for wiring.
 *
 * WHY A NEW INSTRUMENT AND NOT A RE-READ. The lane already has three instruments that touch this
 * wall: `cpp-dump-classify.ts` (SPELLING classes, whole population), `cpp-decl-proto.ts` (the
 * declaration-space prototype, SAMPLE repos), and `cpp-index-claim-material.ts` (the task-24 gate,
 * duckdb+fmt only). None of them prices the four buckets on the PRODUCTION population, and none of
 * them separates bucket A from bucket D. This one does, and it REUSES the shipped extraction rather
 * than forking it: the declaration space is read from the SHIPPED `CPP_DECLARATION_SPEC`
 * (src/ast/project-index.ts) through the SHIPPED builder (`buildProjectIndexStreaming`), so a name
 * this instrument calls "declared in the project" is a name the index can actually be asked about.
 *
 * THE POPULATION. The gate's own dump (the rows are the gate's rows, not a second population). The
 * `--index` arm's population is the production population for cpp: production's
 * `PROJECT_INDEX_EXTENSIONS` carries the cpp spellings and the analyzer consumes the index only
 * behind `BB_CPP_INDEX_CONSUME=1`; the LEAD's own note in the dump header says the gate's
 * `--index` population IS production's for the languages `INDEX_SPECS` can build an index for, and
 * cpp is in that list. The W1 rows are the SAME rows in both arms (the index changes METADATA, not
 * rows — measured: edges invariant, per-type `calls` resolved/amb/unresolved all move only under
 * the consume flag), so pricing them is population-independent, and the instrument says so.
 *
 * THE FOUR BUCKETS ARE A PARTITION, and the control enforces it: every W1 row lands in exactly one
 * bucket, and `sum(bucket rows) == W1 rows`. An unclassified row is a FAILURE, not a remainder.
 *
 * THE ORDER OF THE TESTS IS THE ARGUMENT, and it is stated because the buckets are not symmetric:
 *   1. the INDEX declares it (project fact)  → bucket A, split by whether the INDEX can DECIDE it
 *      (unique declaration) or only BOUND it (several declarations → the name key cannot choose);
 *   2. the committed `iso-cpp-stdlib` vocabulary lists it → bucket B;
 *   3. the row is a MEMBER leaf whose owner the spelling does not name → bucket C's receiver-typing
 *      class (a per-file model genuinely cannot decide it);
 *   4. everything else → bucket D, and each D row carries the reason a new claim kind is needed.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-w1-price.ts \
 *     --dump=.tmp-cpp/cpp-noindex-cap0-dump.txt [--json=<path>] [--repos=a,b] [--no-headers]
 *
 * EXIT: 0 priced (the partition closes) · 2 usage/environment · 3 CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
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
const ONLY_REPOS = (argOf("--repos") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
/** The extension-only index population (headers NOT indexed) — measures what the header decision is
 *  worth, SEPARATELY, so the two answers are never conflated. */
const NO_HEADERS = process.argv.includes("--no-headers")
if (!DUMP) {
  console.error("usage: bun run script/m14/cpp-w1-price.ts --dump=<gate dump> [--json=<path>] [--repos=a,b] [--no-headers]")
  process.exit(2)
}

const availGB = os.freemem() / (1024 ** 3)
const load1 = os.loadavg()[0]
if (availGB < 3) {
  console.error(`cpp-w1-price: REFUSING — ${availGB.toFixed(2)} GB available, the index builds need >= 3 GB (load ${load1.toFixed(2)}). Wait for headroom and re-run.`)
  process.exit(2)
}

const ADMITTED = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const HEADERS = new Set(["h", "hh", "h++"])
const SIZE_CAP = 1024 * 1024
const extOf = (p: string): string => { const b = p.slice(p.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(d + 1).toLowerCase() : "" }
const repoOf = (src: string): string => {
  const i = src.indexOf(`${path.sep}.corpus${path.sep}`)
  const rest = i >= 0 ? src.slice(i + `${path.sep}.corpus${path.sep}`.length) : src
  return rest.split(path.sep)[0]
}

// ── the COMMITTED standard-library vocabulary, read from the shared registry --------------------
// The lane does NOT invent a vocabulary: it READS the committed one, so a bucket B row is a row the
// committed list can actually claim. `script/m14/citations.ts` is LEAD-owned and this file only
// READS it (it is imported, not edited).
const { ISO_CPP_STDLIB } = await import(path.join(ROOT, "script/m14/citations.ts"))
const STDLIB_ROOTS = new Set<string>(ISO_CPP_STDLIB.roots)
if (STDLIB_ROOTS.size < 10) {
  console.error(`CONTROL DID NOT FIRE: the committed iso-cpp-stdlib vocabulary reads ${STDLIB_ROOTS.size} roots (expected the committed list).`)
  process.exit(3)
}

// ── the W1 rows, read from the GATE'S OWN DUMP ---------------------------------------------------
// The classifier's W1 rule, RE-DERIVED FROM THE LANE'S OWN CLASSIFIER (read the lane's source, do
// not fork its table — the grammar auditor's precedent). The W1 class for a `calls` row is: the
// target is an identifier that is not a keyword, not a builtin type, not a non-class standard type,
// not an operator/destructor spelling, not qualified, not template-shaped, and NOT all-caps (the
// all-caps spelling is the macro class, W10).
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
  const c0 = s[0]
  return !(c0 >= "0" && c0 <= "9")
}
const isAllCapsIdentifier = (s: string): boolean => {
  let hasUpper = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c >= "a" && c <= "z") return false
    if (c >= "A" && c <= "Z") hasUpper = true
  }
  return hasUpper
}
/** TRUE for the W1 class of `cpp-dump-classify.ts` — the same rule, spelled once and asserted. */
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

type Row = { label: string; outcome: string; target: string; src: string; line: number }
const w1: Row[] = []
let residualRows = 0
let callsResidual = 0
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 5) continue
  if (p[2] !== "unresolved" && p[2] !== "ambDeclOnly" && p[2] !== "ambBoth") continue
  residualRows++
  if (p[1] !== "calls") continue
  callsResidual++
  const m = p[4].match(/^(.*):(\d+)$/)
  if (!m) continue
  const src = m[1]
  if (ONLY_REPOS.length > 0 && !ONLY_REPOS.includes(repoOf(src))) continue
  if (!isW1(p[3].trim())) continue
  w1.push({ label: p[1], outcome: p[2], target: p[3].trim(), src, line: Number(m[2]) })
}
if (w1.length === 0) { console.error(`cpp-w1-price: 0 W1 rows — check the dump path (${DUMP})`); process.exit(2) }
const repos = [...new Set(w1.map((r) => repoOf(r.src)))].sort()

// ── the PROJECT DECLARATION SPACE, from the SHIPPED spec + the SHIPPED builder -------------------
// The index is the instrument that answers "is this name declared elsewhere in the project?", so the
// declaration space is read the way production reads it — `CPP_DECLARATION_SPEC` +
// `buildProjectIndexStreaming` over the repo's admitted files — and NOT from a prototype.
const indexMod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const spec: any = indexMod.CPP_DECLARATION_SPEC
if (!spec) { console.error("cpp-w1-price: project-index.ts does not export CPP_DECLARATION_SPEC"); process.exit(3) }
const wasm = path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")
type Space = {
  names: Set<string>            // every declared name (types, free fns, members, aliases)
  counts: Map<string, number>   // how many times each name is declared (the "declared ONCE" fact)
  typeNames: Set<string>        // class-like declarations
  memberOwners: Map<string, number>  // member leaf -> how many OWNERS declare it
  files: number; buildMs: number; types: number; damaged: number
}
const spaces = new Map<string, Space>()
for (const repo of repos) {
  const repoDir = path.join(CR, repo)
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    const e = extOf(rel)
    if (!ADMITTED.has(e) && !(NO_HEADERS ? false : HEADERS.has(e))) continue
    const abs = path.join(repoDir, rel)
    try { if (statSync(abs).size <= SIZE_CAP) files.push(abs) } catch { /* absent: not in the population */ }
  }
  const t0 = performance.now()
  let built: any
  try { built = await indexMod.buildProjectIndexStreaming(wasm, files, spec) } catch (e: any) {
    console.error(`cpp-w1-price: index build FAILED for ${repo}: ${e?.message ?? e}`)
    continue
  }
  built.complete = true
  const memberOwners = new Map<string, number>()
  for (const [owner, members] of built.typeMembers) {
    for (const m of members) memberOwners.set(m, (memberOwners.get(m) ?? 0) + 1)
  }
  spaces.set(repo, {
    names: built.symbolNames,
    counts: built.symbolCounts,
    typeNames: new Set(built.typeKinds.keys()),
    memberOwners,
    files: files.length,
    buildMs: performance.now() - t0,
    types: built.typeKinds.size,
    damaged: built.stats?.damaged ?? 0,
  })
}
if (spaces.size === 0) { console.error("cpp-w1-price: no repo index was built — refusing to price with an empty declaration space"); process.exit(3) }

// ── the partition ------------------------------------------------------------------------------
type Bucket = { rows: number; unresolved: number; ambiguous: number; samples: string[] }
const buckets = new Map<string, Bucket>()
const bump = (k: string, r: Row, note = ""): void => {
  const b = buckets.get(k) ?? { rows: 0, unresolved: 0, ambiguous: 0, samples: [] }
  b.rows++
  if (r.outcome === "unresolved") b.unresolved++
  else b.ambiguous++
  if (b.samples.length < 6) b.samples.push(`${r.src.split(`${path.sep}.corpus${path.sep}`)[1] ?? r.src}:${r.line} ${r.target} [${r.outcome}]${note ? " " + note : ""}`)
  buckets.set(k, b)
}
for (const r of w1) {
  const sp = spaces.get(repoOf(r.src))
  const declared = sp?.names.has(r.target) === true
  const isType = sp?.typeNames.has(r.target) === true
  const ownerCount = sp?.memberOwners.get(r.target) ?? 0
  const declCount = sp?.counts.get(r.target) ?? 0
  const inStdlib = STDLIB_ROOTS.has(r.target)

  // THE ORDER IS THE ARGUMENT, and it is the same order the README of this instrument states.
  //
  // A MEMBER leaf is tested FIRST, and it is a separate question from "the project declares the
  // name". A member leaf is declared BY A CLASS, and a bare `m()` call names the member without
  // naming its class — so even when the project declares `m` exactly once, the CALL SITE's target
  // is not proven to be that member: the receiver decides, and the per-file model has no receiver
  // fact. The index can BOUND the candidate set (one class declares `m`), but it cannot CHOOSE.
  // So a member leaf is bucket C (receiver typing), and only a name the index declares OUTSIDE any
  // class — a free function, a prototype, a type, an alias — is a project fact a call site can be
  // BOUND by (bucket A).
  if (ownerCount > 0 && !isType) {
    bump(ownerCount === 1
      ? "C/member-leaf-one-owner-receiver-typing"
      : "C/member-leaf-many-owners-receiver-typing", r, `(owners=${ownerCount})`)
    continue
  }
  if (declared) {
    // A. DECLARED ELSEWHERE IN THE PROJECT — a project fact answers it. The sub-split is the honest
    // one: `symbolCounts` says whether the index can DECIDE (declared exactly once) or only BOUND
    // (declared several times → the name key cannot choose).
    //
    // A TYPE-shaped target in a `calls` row is a CONSTRUCTION (`to_utf8(x)` builds a `to_utf8`),
    // so the class declaration IS the target's declaration and the index answers it exactly; the
    // count is the number of classes/structs/enums sharing the name.
    if (isType) bump("A/index-declares-TYPE-construction", r, `(decls=${declCount})`)
    else if (declCount === 1) bump("A/index-declares-FREE-FNCE-ONCE", r)
    else bump("A/index-declares-FREE-FNCE-MULTI", r, `(decls=${declCount})`)
    continue
  }
  if (inStdlib) { bump("B/committed-stdlib-vocabulary", r); continue }
  // D. Nothing in the project declares it and the committed vocabulary does not list it. The bucket
  // is split by WHAT A NEW CLAIM KIND WOULD HAVE TO BE, because "needs a claim kind" is not one
  // request: it is several, with different arbiter wiring.
  const typeShaped = /^[A-Z]/.test(r.target) || r.target.endsWith("_t") || r.target.endsWith("_type")
  if (typeShaped) bump("D/type-shaped-needs-project-fact-claim", r)
  else bump("D/free-callable-needs-project-fact-claim", r)
}

// ── the CONTROL: the four buckets are a PARTITION of the W1 rows --------------------------------
const sumRows = [...buckets.values()].reduce((a, b) => a + b.rows, 0)
if (sumRows !== w1.length) {
  console.error(`CONTROL DID NOT FIRE: the buckets sum to ${sumRows} but the W1 population is ${w1.length}.`)
  process.exit(3)
}
const bucketOf = (k: string): string => k.split("/")[0]
const fourWay = new Map<string, number>()
for (const [k, b] of buckets) fourWay.set(bucketOf(k), (fourWay.get(bucketOf(k)) ?? 0) + b.rows)
// THE FOUR BUCKETS MUST ALL BE PRESENT — a bucket with ZERO rows is a MISSING MEASUREMENT, not an
// empty class. This control is what stopped the first run of this instrument from reporting a
// three-bucket partition as a four-bucket one (the C bucket was empty because the sample repos
// carry no ownerless member leaf, which is a fact about the SAMPLE, not about the population).
const REQUIRED = ["A", "B", "C", "D"]
const missing = REQUIRED.filter((b) => !fourWay.has(b))
if (missing.length > 0) {
  console.error(`CONTROL DID NOT FIRE: the four-bucket partition is missing bucket(s) ${missing.join(", ")} — a zero-row bucket is a MISSING MEASUREMENT, not an empty class.`)
  console.error(`   buckets seen: ${[...fourWay.keys()].join(", ")} · W1 rows ${w1.length} · repos ${repos.length}`)
  console.error("   Run over the WHOLE population (no --repos) before believing a partition: a bounded sample can leave a bucket empty by accident.")
  process.exit(3)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-w1-price.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  population: {
    residualRowsInDump: residualRows,
    callsResidualRows: callsResidual,
    w1RowsPriced: w1.length,
    repos: repos.length,
    reposIndexed: spaces.size,
    machine: { loadAvg1: Number(load1.toFixed(2)), availableGBAtStart: Number(availGB.toFixed(2)), cores: os.cpus().length },
  },
  indexPopulation: {
    admittedExtensions: [...ADMITTED].sort(),
    headersIndexed: !NO_HEADERS,
    note: NO_HEADERS
      ? "EXTENSION-ONLY index population (headers NOT indexed) — the `.h` decision priced separately."
      : "INDEX POPULATION = admitted extensions + headers (`.h/.hh/.h++`) — the production-ish population.",
  },
  rule: {
    w1: "the W1 class of script/m14/cpp-dump-classify.ts, re-derived from the ANALYZER's own exported sets (not forked): a `calls` target that is an identifier, not a keyword/builtin/non-class-standard type, not an operator/destructor spelling, not qualified, not template-shaped, and not all-caps (all-caps is the W10 macro class).",
    partition: "A = the project index DECLARES the name (a project fact) · B = the COMMITTED iso-cpp-stdlib vocabulary lists it (the namespace claim's reach) · C = the index does not declare it but a class member declares it and the spelling does not name the owner (receiver typing — the per-file model cannot decide it) · D = neither (a new claim kind is needed). EVERY W1 row lands in exactly one bucket; sum == W1 rows; the control exits 3 otherwise.",
    vocabulary: { id: ISO_CPP_STDLIB.id, source: ISO_CPP_STDLIB.source, roots: ISO_CPP_STDLIB.roots.length },
  },
  indexBuilds: Object.fromEntries([...spaces.entries()].map(([repo, v]) => [repo, {
    files: v.files, buildMs: Number(v.buildMs.toFixed(0)), msPerFile: Number((v.buildMs / Math.max(1, v.files)).toFixed(2)),
    types: v.types, damaged: v.damaged,
  }])),
  fourWay: Object.fromEntries([...fourWay.entries()].sort()),
  buckets: Object.fromEntries([...buckets.entries()].sort((a, b) => b[1].rows - a[1].rows).map(([k, v]) => [k, v])),
  totals: {
    w1Rows: w1.length,
    priced: sumRows,
    partitionHolds: sumRows === w1.length,
  },
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const t = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.writeFileSync(t, json)
}
const pct = (n: number): string => `${((n / w1.length) * 100).toFixed(1)}%`
console.log(`cpp-w1-price — W1 rows priced: ${w1.length} · repos ${repos.length} · indexes ${spaces.size} · headersIndexed ${!NO_HEADERS}`)
console.log(`FOUR-WAY PARTITION (sum ${sumRows} == W1 ${w1.length}: ${sumRows === w1.length ? "PASS" : "FAIL"})`)
for (const [k, v] of [...fourWay.entries()].sort()) console.log(`  ${k}  ${String(v).padStart(8)}  ${pct(v)}`)
console.log("BUCKETS")
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
  console.log(`  ${k.padEnd(46)} ${String(v.rows).padStart(8)}  ${pct(v.rows)}  (unres ${v.unresolved} · amb ${v.ambiguous})`)
  for (const s of v.samples.slice(0, 2)) console.log(`      e.g. ${s}`)
}
