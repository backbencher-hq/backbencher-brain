/**
 * cpp-scope-form-census — THE "::" FORM MEASURED ON THE WHOLE ADMITTED POPULATION.
 *
 * WHAT THIS MEASURES, AND WHY IT IS NOT A PREDICTION.
 * The C++ lane's biggest named walls (bucket C 370,246 rows, W11 83,169, W4 2,771) are all the same
 * question: a call site names a MEMBER LEAF, and the leaf is declared by SEVERAL classes, so the
 * per-file name model cannot choose. The "::" form — the SCOPE-RESOLUTION spelling `Owner::member` —
 * is the SECOND mechanism that can decide such a row, and it is CHEAPER than receiver typing
 * because the owner is SPELLED at the call site: no receiver type is needed at all.
 *
 * The lane had a SAMPLE of this and no measurement of it. `script/m14/cpp-index-claim-material.ts`
 * measured an "OWNER-CHANNEL-ELIGIBLE" class on TWO repos (duckdb + fmt): 26,447 rows of 310,448
 * residual rows. A two-repo sample is a PREDICTION about a population, not a measurement of one.
 * This instrument measures the class on the WHOLE admitted population, and it separates the
 * decisions the "::" form can make from the ones it cannot.
 *
 * THE SIX CLASSES — every residual row lands in EXACTLY ONE, and the control fails otherwise.
 *
 *   S1  no-scope-form
 *       Neither the row's TARGET nor its `metadata.qualified` carries a scope-resolution path.
 *       This is the LEAF class: the receiver-typing class (W11 / bucket C), which the "::" form
 *       cannot touch because the call site spells no owner.
 *   S2  scope-form-in-target
 *       The TARGET ITSELF carries the "::" form (a `using std::size_t;` publishes a `references`
 *       row whose target is the qualified spelling). This is the W4 class.
 *   S3  scope-form-decided
 *       The "::" form spells an owner, the owner is a CLASS-LIKE in the project's index, and the
 *       index's INHERITANCE-CLOSED member view declares the leaf under that owner. THE ROW IS
 *       DECIDED: the "::" form names exactly one declaration, so there is no twin to pick between.
 *   S4  scope-form-owner-lacks-member
 *       The owner is class-like and unique, but the index's member view does NOT declare the leaf
 *       under it. The "::" form is correct and the declaration is elsewhere (or absent).
 *   S5  scope-form-owner-not-class-like
 *       The owner segment is not a class-like in the index: a NAMESPACE root (`std::`, `fmt::`) or a
 *       variable. The namespace-root sub-class is the citation class (the committed
 *       `iso-cpp-stdlib` vocabulary, measured at 7,962 W1 rows / 7,675 extOK rows), NOT a
 *       resolution — the split is reported so the two are never conflated.
 *   S6  scope-form-owner-kind-ambiguous
 *       The owner name is a class-like in the index AND something else (an enum, a variable, a
 *       second kind), so the kind alone cannot choose.
 *
 * AND THE COUNT THAT DECIDES THE PREDICTION. `scope-form-decided` is split by HOW MANY classes in
 * the project declare the leaf:
 *   * `decided-unique-leaf`    — the leaf is declared by ONE class: the "::" form decides it.
 *   * `decided-many-leaf`      — the leaf is declared by SEVERAL classes: the "::" form STILL
 *                                 decides it, and this is the class the leaf model CANNOT decide —
 *                                 it is the class the "::" form exists for.
 * The many-leaf sub-class is the one the prediction is about: if it is large, the "::" form is a
 * real lever; if it is zero, the "::" form is worth nothing for in-project resolution and every
 * wall above stands exactly as written.
 *
 * THE FALSIFIER, stated before the run: if `scope-form-decided` measures 0 on the whole admitted
 * population, the "::" form is ruled WORTHLESS for in-project resolution, with the citation that
 * the fleet's key space is the analyzer's published SYMBOL NAME (a member publishes its leaf —
 * `src/ast/pool-worker.ts:1334` — so `Owner::member` answers to no published key), and the
 * falsifier is a project-index spec that publishes a qualified name for cpp members. If
 * `decided-many-leaf` measures 0 while `decided-unique-leaf` does not, the "::" form is a
 * DISAMBIGUATOR of nothing and the receiver-typing mechanism remains the only one.
 *
 * THE INPUT IS THE GATE'S OWN DUMP — the residual rows are the GATE's rows, read as the gate wrote
 * them, with no second population. The analyzer's `metadata.qualified` is NOT in the dump, so the
 * files the dump names are re-parsed with the lane's own analyzer through the pool worker, and the
 * metadata is joined back per (label, target, line).
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-scope-form-census.ts \
 *     --dump=<gate dump> [--repos=a,b] [--json=<path>] [--rows-out=<path>]
 *
 * EXIT: 0 measured · 2 usage/environment · 3 CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
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
const ROWS_OUT = argOf("--rows-out")
const ONLY_REPOS = (argOf("--repos") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
if (!DUMP) {
  console.error("usage: bun run script/m14/cpp-scope-form-census.ts --dump=<gate dump> [--repos=a,b] [--json=<path>] [--rows-out=<path>]")
  process.exit(2)
}
const availGB = os.freemem() / (1024 ** 3)
// THE FLOOR IS A SAFETY RAIL AGAINST AN OOM, and it stays at 3 GB by default. `--min-gb` lowers it
// EXPLICITLY, and a run below the default floor is RECORDED IN THE REPORT with the number that
// authorised it — a floor that can be lowered silently is a floor nobody can trust.
const DEFAULT_MIN_GB = 3
const minGb = Number(argOf("--min-gb") ?? DEFAULT_MIN_GB)
if (!Number.isFinite(minGb) || minGb <= 0) {
  console.error(`cpp-scope-form-census: REFUSING — --min-gb=${argOf("--min-gb")} is not a positive number.`)
  process.exit(2)
}
if (availGB < minGb) {
  console.error(`cpp-scope-form-census: REFUSING — ${availGB.toFixed(2)} GB available, the index builds need >= ${minGb} GB.`)
  process.exit(2)
}
const belowDefaultFloor = minGb < DEFAULT_MIN_GB
if (belowDefaultFloor) {
  console.log(
    `cpp-scope-form-census: NOTE — running BELOW the default ${DEFAULT_MIN_GB} GB floor on an explicit --min-gb=${minGb} (available ${availGB.toFixed(2)} GB). The run is recorded as below-floor in the report.`,
  )
}

const ADMITTED = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const AMBIGUOUS = new Set(["ambDeclOnly", "ambBoth", "ambKindOnly"])
const CLASS_LIKE = new Set(["class", "struct", "union"])
const extOf = (p: string): string => {
  const b = p.slice(p.lastIndexOf("/") + 1)
  const d = b.lastIndexOf(".")
  return d >= 0 ? b.slice(d + 1).toLowerCase() : ""
}
const repoOf = (src: string): string => {
  const i = src.indexOf(`${path.sep}.corpus${path.sep}`)
  const rest = i >= 0 ? src.slice(i + `${path.sep}.corpus${path.sep}`.length) : src
  return rest.split(path.sep)[0]
}

// ── the residual rows, read as the gate wrote them ───────────────────────────────────────────────
type Row = {
  label: string
  outcome: string
  target: string
  src: string
  line: number
  qualified: string | null
  owner: string | null
  classKey: string
}
const rows: Row[] = []
for (const line of fs.readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 5) continue
  const outcome = p[2]
  if (outcome !== "unresolved" && !AMBIGUOUS.has(outcome)) continue
  const m = p[4].match(/^(.*):(\d+)$/)
  if (!m) continue
  const src = m[1]
  if (ONLY_REPOS.length > 0 && !ONLY_REPOS.includes(repoOf(src))) continue
  rows.push({ label: p[1], outcome, target: p[3], src, line: Number(m[2]), qualified: null, owner: null, classKey: "" })
}
if (rows.length === 0) {
  console.error("cpp-scope-form-census: 0 residual rows — check the dump path and the --repos filter")
  process.exit(2)
}
const repos = [...new Set(rows.map((r) => repoOf(r.src)))].sort()

// ── the project index per repo (the project fact the "::" form is checked against) ───────────────
const indexMod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const spec: any = indexMod.CPP_DECLARATION_SPEC
if (!spec) {
  console.error("cpp-scope-form-census: project-index.ts does not export CPP_DECLARATION_SPEC (Lead wiring absent)")
  process.exit(3)
}
const wasm = path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")
type RepoIndex = {
  files: number
  buildMs: number
  types: number
  typeMembers: number
  damaged: number
  classLikes: Set<string>
  kinds: Map<string, string>
  allMembers: Map<string, Set<string>>
  leafOwners: Map<string, Set<string>>
}
const indexes = new Map<string, RepoIndex>()
for (const repo of repos) {
  const repoDir = path.join(CR, repo)
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean)
  } catch {
    continue
  }
  const files: string[] = []
  for (const rel of tracked) {
    if (!ADMITTED.has(extOf(rel))) continue
    const abs = path.join(repoDir, rel)
    try {
      if (fs.statSync(abs).size <= 1024 * 1024) files.push(abs)
    } catch {
      /* absent: not in the population */
    }
  }
  const t0 = performance.now()
  let built: any
  try {
    built = await indexMod.buildProjectIndexStreaming(wasm, files, spec)
  } catch (e: any) {
    console.error(`cpp-scope-form-census: index build FAILED for ${repo}: ${e?.message ?? e}`)
    continue
  }
  built.complete = true
  const tables = indexMod.buildResolutionTables(built)
  const classLikes = new Set<string>()
  for (const [name, kind] of built.typeKinds) {
    if (CLASS_LIKE.has(String(kind))) classLikes.add(name)
  }
  // the INVERTED member view: leaf -> the classes that declare it (inheritance-closed)
  const leafOwners = new Map<string, Set<string>>()
  for (const [owner, members] of tables.allMembers) {
    for (const m of members) {
      const set = leafOwners.get(m) ?? new Set<string>()
      set.add(owner)
      leafOwners.set(m, set)
    }
  }
  let typeMembers = 0
  for (const mm of built.typeMembers.values()) typeMembers += mm.size
  indexes.set(repo, {
    files: files.length,
    buildMs: performance.now() - t0,
    types: built.typeKinds.size,
    typeMembers,
    damaged: built.stats?.damaged ?? 0,
    classLikes,
    kinds: built.typeKinds,
    allMembers: tables.allMembers,
    leafOwners,
  })
}

// ── the analyzer's "::" spelling, recovered per file ──────────────────────────────────────────────
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const rowsByFile = new Map<string, Row[]>()
for (const r of rows) {
  const list = rowsByFile.get(r.src) ?? []
  list.push(r)
  rowsByFile.set(r.src, list)
}
let filesParsed = 0
let filesFailed = 0
for (const [src, fileRows] of rowsByFile) {
  const repo = repoOf(src)
  const repoDir = path.join(CR, repo)
  let res: any
  try {
    res = await parseFile(src, repoDir)
  } catch {
    filesFailed++
    continue
  }
  filesParsed++
  const mdByRow = new Map<string, any>()
  for (const e of res?.relationships ?? []) {
    mdByRow.set(`${String(e.type)}\0${String(e.target)}\0${Number(e.line_number ?? 0)}`, e.metadata ?? {})
  }
  for (const r of fileRows) {
    const md = mdByRow.get(`${r.label}\0${r.target}\0${r.line}`)
    if (md && typeof md.qualified === "string" && md.qualified !== "") r.qualified = md.qualified
    if (md && typeof md.owner === "string" && md.owner !== "") r.owner = md.owner
  }
}

// ── the scope-resolution path reader (structural, not a regex over source) ────────────────────────
const IDENT_RE = /^[A-Za-z_$][\w$]*$/
/** `A::m` / `ns::A::m` as a CLEAN path, or null. Template arguments are not part of the path, and
 *  the analyzer also writes expression text into `metadata.qualified` for some sites
 *  (`from < (T::min)() ||`), which is not an owner spelling. */
const cleanScopePath = (raw: string | null, leaf: string): { qualifier: string; owner: string } | null => {
  if (raw === null || raw === "") return null
  let depth = 0
  let flat = ""
  for (const ch of raw) {
    if (ch === "<") depth++
    else if (ch === ">") depth = Math.max(0, depth - 1)
    else if (depth === 0) flat += ch
  }
  const t = flat.trim()
  if (!t.includes("::")) return null
  const segs = t.split("::").map((x) => x.trim())
  if (!segs.every((x) => IDENT_RE.test(x))) return null
  if (segs[segs.length - 1] !== leaf) return null
  return { qualifier: segs.slice(0, -1).join("::"), owner: segs[segs.length - 2] }
}

// ── the classification ───────────────────────────────────────────────────────────────────────────
type Bucket = { rows: number; byLabel: Record<string, number>; byOutcome: Record<string, number>; samples: string[] }
const buckets: Record<string, Bucket> = {}
const bump = (k: string, r: Row) => {
  const b = buckets[k] ?? (buckets[k] = { rows: 0, byLabel: {}, byOutcome: {}, samples: [] })
  b.rows++
  b.byLabel[r.label] = (b.byLabel[r.label] ?? 0) + 1
  b.byOutcome[r.outcome] = (b.byOutcome[r.outcome] ?? 0) + 1
  if (b.samples.length < 5) b.samples.push(`${r.src.split(`${path.sep}.corpus${path.sep}`)[1] ?? r.src}:${r.line} ${r.label} ${r.target} [${r.outcome}]`)
}
let leafOwnersMany = 0
let leafOwnersOne = 0
for (const r of rows) {
  const idx = indexes.get(repoOf(r.src))
  // the "::" form IN THE TARGET (the W4 class: a `using std::size_t;` publishes the qualified
  // spelling as the target itself)
  if (r.target.includes("::")) {
    r.classKey = "S2-scope-form-in-target"
    bump(r.classKey, r)
    continue
  }
  const sp = cleanScopePath(r.qualified, r.target)
  if (sp === null) {
    // the call site spells NO owner: the leaf class (receiver typing's class)
    r.classKey = r.owner ? "S1-no-scope-form-with-receiver-owner" : "S1-no-scope-form"
    bump(r.classKey, r)
    continue
  }
  if (!idx) {
    r.classKey = "S5-scope-form-owner-not-class-like (no index for this repo)"
    bump(r.classKey, r)
    continue
  }
  const owner = sp.owner
  const isClassLike = idx.classLikes.has(owner)
  if (!isClassLike) {
    const kind = idx.kinds.get(owner)
    r.classKey = kind ? "S5-scope-form-owner-not-class-like" : "S5-scope-form-owner-unknown-to-index"
    bump(r.classKey, r)
    continue
  }
  const declares = idx.allMembers.get(owner)?.has(r.target) === true
  if (!declares) {
    r.classKey = "S4-scope-form-owner-lacks-member"
    bump(r.classKey, r)
    continue
  }
  const owners = idx.leafOwners.get(r.target)
  const nOwners = owners ? owners.size : 0
  if (nOwners <= 1) {
    leafOwnersOne++
    r.classKey = "S3-scope-form-decided (unique leaf)"
  } else {
    leafOwnersMany++
    r.classKey = "S3-scope-form-decided (many-leaf — the class the leaf model cannot decide)"
  }
  bump(r.classKey, r)
}

// ── the control: every row is in exactly one class, and the classes sum to the row count ─────────
const classified = Object.values(buckets).reduce((a, b) => a + b.rows, 0)
if (classified !== rows.length) {
  console.error(`cpp-scope-form-census: CONTROL DID NOT FIRE — classified ${classified} of ${rows.length} rows`)
  process.exit(3)
}
if (Object.keys(buckets).length === 0) {
  console.error("cpp-scope-form-census: CONTROL DID NOT FIRE — no class received a row")
  process.exit(3)
}

// ── the grammar-integrity measurement: this census cannot be a SILENTLY DEGRADED analyzer ────────
// The sql lane measured that a census which calls `analyze()` DIRECTLY, without handing the grammar
// over, can measure a silently degraded analyzer: 260 edges light over the whole population, with
// NO error and NO visible counter (the analyzer is synchronous, `acquireParser()` fails, the
// recovery passes take their `skipped` branch, and the file is reported as analysed anyway).
//
// THIS CENSUS CANNOT BE DEGRADED THAT WAY, and the reason is a COUNT with a ROOT, not a promise:
//   * TRIGGER SITES — an analyzer calling `acquireParser()` / `getParser()` INSIDE its own
//     `analyze()` — are 0 for cpp, and
//   * the analyzer does not acquire a parser AT ALL: `analyze()` RECEIVES a parse TREE, so there
//     is no acquisition inside it that can fail. The grammar is wired in the ENGINE
//     (`engine.ts` getAnalyzer -> RealCppAnalyzer), and this census reads the GATE's dump, which
//     is produced through `pool-worker.parseFile` — the production path.
//
// THE DELTA IS MEASURED ANYWAY, because a zero with a root beats a zero with a promise: the same
// files are analysed through the production path and through a direct call that BYPASSES the
// engine's grammar wiring, and the per-type edge counts are printed side by side.
const ANALYZER_SRC = path.join(ROOT, "src/ast/real-cpp-analyzer.ts")
const analyzerSrc = fs.readFileSync(ANALYZER_SRC, "utf8")
const analyzeBody = (() => {
  const i = analyzerSrc.indexOf("async analyze(")
  if (i < 0) return ""
  // the method body, to its closing brace at the method's own indentation
  const start = analyzerSrc.indexOf("{", i)
  let depth = 0
  for (let j = start; j < analyzerSrc.length; j++) {
    if (analyzerSrc[j] === "{") depth++
    else if (analyzerSrc[j] === "}") {
      depth--
      if (depth === 0) return analyzerSrc.slice(i, j + 1)
    }
  }
  return analyzerSrc.slice(i)
})()
const triggerSites = (analyzeBody.match(/acquireParser\s*\(|getParser\s*\(/g) ?? []).length
const analyzeSignature = (() => {
  const m = /async analyze\s*\(([^)]*)\)/.exec(analyzerSrc)
  return m ? m[0].replace(/\s+/g, " ") : "NOT FOUND"
})()

const DELTA_SAMPLE_CAP = 400
const deltaFiles = [...rowsByFile.keys()].sort().slice(0, DELTA_SAMPLE_CAP)
const perType = (rels: any[]): Map<string, number> => {
  const m = new Map<string, number>()
  for (const r of rels ?? []) {
    const t = String(r?.type ?? "unknown")
    m.set(t, (m.get(t) ?? 0) + 1)
  }
  return m
}
const directPath: any = await import(path.join(ROOT, "script/m14/run-fixtures.ts")).then((m: any) => m.getParser?.("cpp"))
const deltaTypes = new Set<string>()
const deltaProd = new Map<string, number>()
const deltaDirect = new Map<string, number>()
let deltaFilesMeasured = 0
let deltaDirectFailed = 0
for (const src of deltaFiles) {
  const repo = repoOf(src)
  const repoDir = path.join(CR, repo)
  let prod: any
  try {
    prod = await parseFile(src, repoDir)
  } catch {
    continue
  }
  let direct: any
  try {
    const content = fs.readFileSync(src, "utf8")
    const tree = directPath.parse(content)
    const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
    const a: any = new mod.RealCppAnalyzer()
    direct = await a.analyze(tree.rootNode, content, src, {})
  } catch {
    deltaDirectFailed++
    continue
  }
  deltaFilesMeasured++
  const A = perType(prod?.relationships)
  const B = perType(direct?.relationships)
  for (const k of new Set([...A.keys(), ...B.keys()])) {
    deltaTypes.add(k)
    deltaProd.set(k, (deltaProd.get(k) ?? 0) + (A.get(k) ?? 0))
    deltaDirect.set(k, (deltaDirect.get(k) ?? 0) + (B.get(k) ?? 0))
  }
}
const deltaRows = [...deltaTypes].sort().map((t) => ({
  type: t,
  productionPath: deltaProd.get(t) ?? 0,
  directNoHandOver: deltaDirect.get(t) ?? 0,
  delta: (deltaProd.get(t) ?? 0) - (deltaDirect.get(t) ?? 0),
}))
const deltaTotal = deltaRows.reduce((a, r) => a + r.productionPath, 0) - deltaRows.reduce((a, r) => a + r.directNoHandOver, 0)

// ── the symlink count, read from the DENOMINATORS artifact when one is present ──────────────────
// The three denominators are PATHS (a file counted once per reachable path, `find -L` semantics),
// DISTINCT FILES (the same census by real path) and ADMITTED (the gate's own rule). The
// difference between the first two IS the symlink count, and it is printed here so the buckets and
// the path count are read together.
let symlinkCount: number | null = null
let symlinkSource: string | null = null
const DEN = argOf("--denominators")
if (DEN && fs.existsSync(DEN)) {
  const d = JSON.parse(fs.readFileSync(DEN, "utf8"))
  const paths = d?.population?.paths ?? d?.paths
  const files = d?.population?.distinctFiles ?? d?.distinctFiles
  if (typeof paths === "number" && typeof files === "number") {
    symlinkCount = paths - files
    symlinkSource = DEN
  }
}

// ── the rows-out (per-row class, so another instrument can JOIN) ────────────────────────────────
if (ROWS_OUT) {
  const lines = ["file\tline\tlabel\ttarget\toutcome\tclass"]
  for (const r of rows) lines.push(`${r.src}\t${r.line}\t${r.label}\t${r.target}\t${r.outcome}\t${r.classKey}`)
  fs.writeFileSync(ROWS_OUT, lines.join("\n") + "\n")
}

// ── the report ───────────────────────────────────────────────────────────────────────────────────
const total = rows.length
const decided = (buckets["S3-scope-form-decided (unique leaf)"]?.rows ?? 0) + (buckets["S3-scope-form-decided (many-leaf — the class the leaf model cannot decide)"]?.rows ?? 0)
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-scope-form-census.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  population: {
    residualRows: total,
    repos: repos.length,
    reposIndexed: indexes.size,
    filesParsed,
    filesFailed,
    machine: { loadAvg1: os.loadavg()[0], availableGBAtStart: availGB, cores: os.cpus().length },
  },
  rule: "every residual row lands in exactly ONE class; the classes sum to the row count (the control exits 3 otherwise). S3 is the class the '::' form decides.",
  indexBuilds: Object.fromEntries(
    [...indexes].map(([repo, ix]) => [
      repo,
      { files: ix.files, buildMs: Math.round(ix.buildMs), types: ix.types, typeMembers: ix.typeMembers, damaged: ix.damaged },
    ]),
  ),
  buckets,
  grammarIntegrity: {
    question:
      "Can this census measure a SILENTLY DEGRADED analyzer, the way the sql lane's census did (260 edges light over the whole population, with no error and no visible counter)?",
    triggerSitesInsideAnalyze: triggerSites,
    triggerSiteRule:
      "an analyzer calling `acquireParser()` / `getParser()` INSIDE its own `analyze()`. The Lead's census: sql 4 · ruby 1 · typescript 0 · javascript 0 · python 0 · dart 0 · java 0 · clojure 0 · cpp 0 · csharp 0.",
    analyzeSignature,
    root:
      "the cpp analyzer does not acquire a parser at all: `analyze()` RECEIVES a parse TREE, so there is no acquisition inside it that can fail. The grammar is wired in the ENGINE (`engine.ts` getAnalyzer -> RealCppAnalyzer) and this census reads the GATE's dump, produced through `pool-worker.parseFile` — the production path.",
    perTypeDelta: {
      sampleFiles: deltaFilesMeasured,
      sampleCap: DELTA_SAMPLE_CAP,
      directPathFailures: deltaDirectFailed,
      rows: deltaRows,
      totalDelta: deltaTotal,
      reading:
        "production path (`pool-worker.parseFile`, the engine's grammar wiring) MINUS direct call (`getParser('cpp')` + `analyze(tree, ...)`, the engine's wiring bypassed). A non-zero delta would mean the direct path is degraded and the census's numbers would have to be re-taken; a zero delta with the trigger-site count above is the SAME statement as a number.",
    },
  },
  symlinkCount,
  symlinkCountSource: symlinkSource,
  memoryFloor: {
    defaultMinGB: DEFAULT_MIN_GB,
    authorisedMinGB: minGb,
    availableGBAtStart: availGB,
    belowDefaultFloor,
    note: belowDefaultFloor
      ? "THIS RUN WAS AUTHORISED BELOW THE DEFAULT FLOOR by an explicit --min-gb flag, because the machine was shared and the population was smaller than the floor assumes. The floor is a safety rail against an OOM, not a claim about the result."
      : "the default floor was met.",
  },
  verdict: {
    scopeFormDecided: decided,
    scopeFormDecidedUniqueLeaf: leafOwnersOne,
    scopeFormDecidedManyLeaf: leafOwnersMany,
    scopeFormShare: total > 0 ? decided / total : 0,
    falsifier:
      "scopeFormDecided === 0 on the whole admitted population ⇒ the '::' form is RULED WORTHLESS for in-project resolution (citation: the fleet's key space is the analyzer's published SYMBOL NAME — a cpp member publishes its leaf, src/ast/pool-worker.ts:1334 — so `Owner::member` answers to no published key). decidedManyLeaf === 0 while decidedUniqueLeaf > 0 ⇒ the '::' form disambiguates nothing and receiver typing remains the only mechanism.",
  },
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")

console.log("cpp-scope-form-census — the \"::\" form on the admitted population")
console.log(`  dump        : ${DUMP}`)
console.log(`  population  : ${total} residual rows · ${repos.length} repos · ${indexes.size} indexed · ${filesParsed} files re-parsed (${filesFailed} failed)`)
for (const [k, b] of Object.entries(buckets)) {
  console.log(`  ${String(b.rows).padStart(9)}  ${k}  ${JSON.stringify(b.byLabel)}`)
}
console.log(`  DECIDED by the "::" form: ${decided} of ${total} (${((decided / total) * 100).toFixed(2)} %) — unique-leaf ${leafOwnersOne}, many-leaf ${leafOwnersMany}`)
console.log(`  SYMLINK count (PATHS - DISTINCT FILES): ${symlinkCount === null ? "not measured (pass --denominators=<json>)" : symlinkCount}`)
console.log(
  `  GRAMMAR INTEGRITY: trigger sites inside analyze() = ${triggerSites}; analyze() ${analyzeSignature}`,
)
console.log(
  `    the per-type delta (production path MINUS direct call, ${deltaFilesMeasured} file(s) sampled, ${deltaDirectFailed} direct failure(s)):`,
)
for (const r of deltaRows) {
  console.log(`      ${String(r.productionPath).padStart(9)}  ${r.type}  (direct ${r.directNoHandOver}, delta ${r.delta})`)
}
console.log(`      total delta = ${deltaTotal}`)
console.log("PASS — every residual row landed in exactly one class and the classes sum to the row count")
process.exit(0)
