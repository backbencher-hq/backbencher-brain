/**
 * cpp-index-claim-material — the MEASUREMENT the Lead gated task-24 on (charter §18.9):
 * on a cpp dump, how many RESIDUAL rows name a target the project index DECLARES?
 *
 * THE QUESTION, exactly as the Lead posed it: the claim kind `projectIndexDeclaration` would verify
 * "the index declares this name AND the run key space does not". The index is built from the SAME
 * extension population the arm parses, so the class could be near-empty — and a claim kind that
 * verifies nothing is a dead instrument. This instrument measures the class before anyone builds it.
 *
 * WHAT IS COMPARED, per residual row (outcome `unresolved` or ambiguous in the gate dump):
 *   · INDEX-DECLARED: the row's target is in the repo's index `symbolNames` (the index built over
 *     the whole repo, extension-only population, CPP_DECLARATION_SPEC, `complete=true`);
 *   · RUN-DECLARED: the target is among the symbols the RUN's own parse published for that repo
 *     (`pool-worker.parseFile` over the same repo files — the gate's key-space source);
 *   · EVIDENCE: whether the row already carries owner/type evidence (metadata.owner present, or the
 *     row's label is a type-position label: extends/implements/instantiates, or a type-reference
 *     `uses`/`references` row).
 *
 * The CLAIM CANDIDATE is exactly the rule's positive case:
 *     outcome === "unresolved"  AND  index-declared  AND  NOT run-declared
 * (ambiguous rows FAIL the rule's first clause — the run answered them — so they are reported in
 * their own bucket as REFUTED-by-ambiguity, never counted as claim material).
 *
 * It also re-takes the per-repo index BUILD times, duckdb included — the quiet-box measurement the
 * lane committed to before any whole-population arm.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-index-claim-material.ts \
 *     --dump=.tmp-cpp/cpp-noindex-cap0-dump.txt [--json=<path>] [--repos=a,b]
 * Run ONLY with the memory gate satisfied (>= 3 GB available): it builds every repo index.
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
const ONLY_REPOS = (argOf("--repos") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
if (!DUMP) { console.error("usage: bun run script/m14/cpp-index-claim-material.ts --dump=<gate dump> [--json=<path>] [--repos=a,b]"); process.exit(2) }

const availGB = os.freemem() / (1024 ** 3)
const load1 = os.loadavg()[0]
if (availGB < 3) {
  console.error(`cpp-index-claim-material: REFUSING — ${availGB.toFixed(2)} GB available, the memory gate needs >= 3 GB for the index builds (load ${load1.toFixed(2)}). Wait for headroom and re-run.`)
  process.exit(2)
}

const ADMITTED = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const AMBIGUOUS = new Set(["ambDeclOnly", "ambBoth", "ambKindOnly"])
const TYPE_POSITION_LABELS = new Set(["extends", "implements", "instantiates", "overrides"])
const extOf = (p: string): string => { const b = p.slice(p.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(d + 1).toLowerCase() : "" }
const repoOf = (src: string): string => {
  const i = src.indexOf(`${path.sep}.corpus${path.sep}`)
  const rest = i >= 0 ? src.slice(i + `${path.sep}.corpus${path.sep}`.length) : src
  return rest.split(path.sep)[0]
}

// ── the residual rows ────────────────────────────────────────────────────────────────────────────
type Row = { label: string; outcome: string; target: string; src: string; line: number; owner: string | null; qualified: string | null }
const rows: Row[] = []
for (const line of fs.readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 5) continue
  const label = p[1]
  const outcome = p[2]
  if (outcome !== "unresolved" && !AMBIGUOUS.has(outcome)) continue
  const m = p[4].match(/^(.*):(\d+)$/)
  if (!m) continue
  const src = m[1]
  const repo = repoOf(src)
  if (ONLY_REPOS.length > 0 && !ONLY_REPOS.includes(repo)) continue
  rows.push({ label, outcome, target: p[3], src, line: Number(m[2]), owner: null, qualified: null })
}
if (rows.length === 0) { console.error("cpp-index-claim-material: 0 residual rows — check the dump path"); process.exit(2) }
const repos = [...new Set(rows.map((r) => repoOf(r.src)))].sort()

// ── the repo indexes (the claim's declaration space) ─────────────────────────────────────────────
const indexMod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const spec: any = indexMod.CPP_DECLARATION_SPEC
if (!spec) { console.error("cpp-index-claim-material: project-index.ts does not export CPP_DECLARATION_SPEC (Lead wiring absent)"); process.exit(3) }
const wasm = path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")
const indexes = new Map<string, { names: Set<string>; files: number; buildMs: number; types: number; typeMembers: number; damaged: number }>()
for (const repo of repos) {
  const repoDir = path.join(CR, repo)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!ADMITTED.has(extOf(rel))) continue
    const abs = path.join(repoDir, rel)
    try { if (fs.statSync(abs).size <= 1024 * 1024) files.push(abs) } catch { /* absent: not in the population */ }
  }
  const t0 = performance.now()
  let built: any
  try {
    built = await indexMod.buildProjectIndexStreaming(wasm, files, spec)
  } catch (e: any) {
    console.error(`cpp-index-claim-material: index build FAILED for ${repo}: ${e?.message ?? e}`)
    continue
  }
  built.complete = true
  const types = built.typeKinds.size
  let memberTotal = 0
  for (const m2 of built.typeMembers.values()) memberTotal += m2.size
  indexes.set(repo, { names: built.symbolNames, files: files.length, buildMs: performance.now() - t0, types, typeMembers: memberTotal, damaged: built.stats?.damaged ?? 0 })
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/
/** `A::m` / `ns::A::m` as a CLEAN path, or null. The analyzer also writes expression text into
 *  metadata.qualified for some sites (`from < (T::min)() ||`), which is not an owner spelling. */
const cleanQualifiedPath = (raw: string | null, leaf: string): { qualifier: string; owner: string } | null => {
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

// ── the RUN key space (what the arm's own parse declared, per repo) ──────────────────────────────
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const runSymbols = new Map<string, Set<string>>()
/** Everything the owner channel needs from the RUN pool: class-like identities (the gate's
 *  OWNER_CLASS_LIKE + cpp's struct/union spellings) and each owner's declared members. */
const runClassLike = new Map<string, Map<string, number>>()
const runOwnerMembers = new Map<string, Set<string>>()
const filesByRepo = new Map<string, string[]>()
for (const r of rows) {
  const repo = repoOf(r.src)
  const list = filesByRepo.get(repo) ?? []
  if (!list.includes(r.src)) list.push(r.src)
  filesByRepo.set(repo, list)
}
for (const repo of repos) {
  const names = new Set<string>()
  const repoDir = path.join(CR, repo)
  const residualRowsByFile = new Map<string, Row[]>()
  for (const r of rows) {
    if (repoOf(r.src) !== repo) continue
    const list = residualRowsByFile.get(r.src) ?? []
    list.push(r)
    residualRowsByFile.set(r.src, list)
  }
  // every admitted file of the repo, exactly the population the whole-population arm parses
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean) } catch { /* no checkout */ }
  for (const rel of tracked) {
    if (!ADMITTED.has(extOf(rel))) continue
    const abs = path.join(repoDir, rel)
    try { if (fs.statSync(abs).size > 1024 * 1024) continue } catch { continue }
    let res: any
    try { res = await parseFile(abs, repoDir) } catch { continue }
    for (const sym of res?.symbols ?? []) {
      const symName = String(sym.name ?? "")
      names.add(symName)
      const kind = String(sym.kind ?? "")
      if (kind === "class" || kind === "struct" || kind === "union" || kind === "enum") {
        const m = runClassLike.get(symName) ?? new Map<string, number>()
        m.set(kind, (m.get(kind) ?? 0) + 1)
        runClassLike.set(symName, m)
      }
      const ownerName = typeof (sym as any).ownerName === "string" ? String((sym as any).ownerName) : ""
      if (ownerName !== "") {
        const set = runOwnerMembers.get(ownerName) ?? new Set<string>()
        set.add(symName)
        runOwnerMembers.set(ownerName, set)
      }
    }
    const fileRows = residualRowsByFile.get(abs)
    if (fileRows === undefined) continue
    // metadata join for the owner-evidence split (per file, keyed label\0target\0line)
    const mdByRow = new Map<string, any>()
    for (const e of res?.relationships ?? []) mdByRow.set(`${String(e.type)}\0${String(e.target)}\0${Number(e.line_number ?? 0)}`, e.metadata ?? {})
    for (const r of fileRows) {
      const md = mdByRow.get(`${r.label}\0${r.target}\0${r.line}`)
      if (md && typeof md.owner === "string" && md.owner.length > 0) r.owner = md.owner
      if (md && typeof md.qualified === "string") r.qualified = md.qualified
    }
  }
  runSymbols.set(repo, names)
  void repoDir
}

// ── classification ───────────────────────────────────────────────────────────────────────────────
type Bucket = { rows: number; byLabel: Record<string, number>; samples: string[] }
const buckets: Record<string, Bucket> = {}
const bump = (k: string, r: Row) => {
  const b = buckets[k] ?? (buckets[k] = { rows: 0, byLabel: {}, samples: [] })
  b.rows++
  b.byLabel[r.label] = (b.byLabel[r.label] ?? 0) + 1
  if (b.samples.length < 5) b.samples.push(`${r.src.split(`${path.sep}.corpus${path.sep}`)[1] ?? r.src}:${r.line} ${r.label} ${r.target} [${r.outcome}]`)
}
for (const r of rows) {
  const idx = indexes.get(repoOf(r.src))
  const run = runSymbols.get(repoOf(r.src)) ?? new Set()
  const indexDeclared = idx?.names.has(r.target) === true
  const runDeclared = run.has(r.target)
  const evidence = r.owner !== null ? "owner" : TYPE_POSITION_LABELS.has(r.label) ? "type-position" : "none"
  const base = `index=${indexDeclared ? "yes" : "no"}|run=${runDeclared ? "yes" : "no"}|evidence=${evidence}`
  if (r.outcome === "unresolved") {
    if (indexDeclared && !runDeclared) bump(`CLAIM-CANDIDATE|${base}`, r)
    else if (indexDeclared && runDeclared) bump(`NAME-IN-BOTH|${base}`, r)
    else bump(`NOT-INDEX-DECLARED|${base}`, r)
  } else {
    // ambiguous: the run answered the row, so the claim rule's first clause fails — REFUTED, never
    // claim material. Counted so the rule's cost is visible, not hidden.
    if (indexDeclared && !runDeclared) bump(`REFUTED-BY-AMBIGUITY|${base}`, r)
    else bump(`AMBIGUOUS-OTHER|${base}`, r)
  }
}

// ── OWNER-CHANNEL POTENTIAL (the Lead's fallback path, measured on the same pass) ───────────────
// The gate's owner channel resolves a calls/uses row that CARRIES metadata.owner by binding the
// receiver's class through its own member lookup. The analyzer does not emit metadata.owner today
// (this lane has NO receiver typing — stated in its own comments), but a QUALIFIED call spelling
// (`Owner::member(...)`) names the owner SYNTACTICALLY, so consumption can attach a truthful
// metadata.owner for that subset. This measures how many residual rows that subset could move,
// under the gate's model: the owner must identify exactly ONE class-like symbol in the RUN pool and
// that owner must DECLARE the member (or an ancestor must — the run pools the channel reads are the
// run's own symbols, so cross-file-only members do not count).
const ownerPotential: Record<string, { rows: number; byLabel: Record<string, number>; samples: string[] }> = {}
const bumpOwner = (k: string, r: Row) => {
  const b = ownerPotential[k] ?? (ownerPotential[k] = { rows: 0, byLabel: {}, samples: [] })
  b.rows++
  b.byLabel[r.label] = (b.byLabel[r.label] ?? 0) + 1
  if (b.samples.length < 6) b.samples.push(`${r.src.split(`${path.sep}.corpus${path.sep}`)[1] ?? r.src}:${r.line} ${r.label} ${r.qualified ?? r.target} [${r.outcome}]`)
}
for (const r of rows) {
  if (r.label !== "calls" && r.label !== "uses") continue
  const path2 = cleanQualifiedPath(r.qualified, r.target)
  if (path2 === null) { bumpOwner("no-qualified-owner-spelling", r); continue }
  const kinds = runClassLike.get(path2.owner)
  if (!kinds || kinds.size === 0) {
    // the owner segment is not a class-like RUN symbol: a namespace spelling or a variable
    bumpOwner("owner-not-class-like-in-run", r)
    continue
  }
  if (kinds.size > 1) { bumpOwner("owner-kind-ambiguous-in-run", r); continue }
  const declares = runOwnerMembers.get(path2.owner)?.has(r.target) === true
  bumpOwner(declares ? "OWNER-CHANNEL-ELIGIBLE (unique class-like owner + declares member in run pool)" : "owner-unique-but-run-pool-lacks-member", r)
}

const claimCandidates = Object.entries(buckets).filter(([k]) => k.startsWith("CLAIM-CANDIDATE|"))
const claimRows = claimCandidates.reduce((a, [, b]) => a + b.rows, 0)
const perRepoClaim: Record<string, number> = {}
for (const [k, b] of claimCandidates) {
  const byRepo = new Map<string, number>()
  for (const sample of b.samples) byRepo.set(sample.split(":")[0], (byRepo.get(sample.split(":")[0]) ?? 0) + 1)
  // exact per-repo counts need a second pass (samples cap at 5) — recomputed below
}
for (const r of rows) {
  const idx = indexes.get(repoOf(r.src))
  const run = runSymbols.get(repoOf(r.src)) ?? new Set()
  if (r.outcome === "unresolved" && idx?.names.has(r.target) === true && !run.has(r.target)) {
    perRepoClaim[repoOf(r.src)] = (perRepoClaim[repoOf(r.src)] ?? 0) + 1
  }
}
const material = claimRows >= 1000
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-index-claim-material.ts",
  measuredAt: new Date().toISOString(),
  dump: DUMP,
  population: { residualRows: rows.length, repos: repos.length, reposIndexed: indexes.size, machine: { loadAvg1: Number(load1.toFixed(2)), availableGBAtStart: Number(availGB.toFixed(2)), cores: os.cpus().length } },
  rule: "CLAIM-CANDIDATE = outcome unresolved AND target in repo index symbolNames AND target NOT in the run's own symbols. Ambiguous rows fail the rule's first clause (the run answered them) and appear as REFUTED-BY-AMBIGUITY. Evidence split = row metadata.owner present | type-position label | none.",
  indexBuilds: Object.fromEntries([...indexes.entries()].map(([repo, v]) => [repo, { files: v.files, buildMs: Number(v.buildMs.toFixed(0)), msPerFile: Number((v.buildMs / Math.max(1, v.files)).toFixed(2)), types: v.types, typeMembers: v.typeMembers, damaged: v.damaged }])),
  buckets,
  ownerPotential,
  totals: {
    claimCandidates: claimRows,
    perRepoClaim,
    ownerChannelEligible: ownerPotential["OWNER-CHANNEL-ELIGIBLE (unique class-like owner + declares member in run pool)"]?.rows ?? 0,
    indexBuildsTotalMs: Number([...indexes.values()].reduce((a, v) => a + v.buildMs, 0).toFixed(0)),
    material: material ? "MATERIAL (>= 1000 rows)" : "NEAR-ZERO (< 1000 rows)",
  },
  verdict: material
    ? "The claim class is MATERIAL — build projectIndexDeclaration with the stated rule (verified iff index declares AND run declCount==0; refuted if the run answers it)."
    : "The claim class is NEAR-ZERO — do NOT build the claim kind; the movement path is the owner channel / receiver typing, not a claim kind.",
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) { const t = path.resolve(ROOT, JSON_OUT); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, json) }
process.stdout.write(json)
