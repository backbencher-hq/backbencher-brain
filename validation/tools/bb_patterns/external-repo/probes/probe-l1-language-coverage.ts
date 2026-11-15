// bb_tests/bb_patterns/probes/probe-l1-language-coverage.ts
// L1 — bb_patterns across every language in the corpus, end to end.
//
// THE REQUIREMENT. "Verify it works on all the languages." A tool that is
// correct on Ruby and wrong on Haskell has not been verified, and the only way
// to know is to run it on each and read the answer. This probe runs the REAL
// engine over every indexed repository in the corpus and reports per language:
//
//   candidates        what the scan produced
//   FP%               candidates the SOURCE TEXT contradicts (a text oracle, not
//                     the index, because the index cannot adjudicate its own
//                     labels — see probe-r5)
//   disclosures       how many findings carry the refused-evidence or
//                     coverage-gap disclaimer, i.e. are honest about a gap
//   nonCodeShare      the share of the candidate pool in markdown/yaml/json, the
//                     noise the language gate exists to remove
//   ms                wall clock, so a corpus that makes the tool unusable is
//                     visible rather than discovered by a user
//
// A language with 0 candidates is NOT a pass. It is either genuinely clean, or
// its symbols are not being indexed, or the gate suppressed everything. Those
// are three very different answers and the probe separates them by also
// reporting the file and symbol counts the engine scanned.

import path from "node:path"
import { createRequire } from "node:module"
import { readFileSync, readdirSync, statSync, realpathSync, existsSync as exists } from "node:fs"
import { createHash } from "node:crypto"

const REPO = process.env.BB_REPO
const CORPUS = "/Users/sano/Documents/Default Project/ishaq/bb_tests/repositories"
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const { detectOrphans } = await import(path.join(REPO, "src/intelligence/patterns/orphans.ts"))

// ---------------------------------------------------------------- corpora
const dataDirs = (process.env.BB_DATA_DIR ?? "").split(":").filter(Boolean)
const NON_USAGE = new Set(["contains", "exports"])
const NON_CODE = new Set([
  "markdown", "yaml", "toml", "json", "xml", "css", "scss", "less", "html", "htm",
  "vue", "svelte", "ini", "cfg", "conf", "properties", "env", "csv", "tsv", "text",
  "plaintext", "rst", "tex", "bib", "org", "adoc", "asciidoc",
])
const SRC_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs", ".lua",
  ".ex", ".exs", ".clj", ".cljs", ".java", ".kt", ".c", ".h", ".cpp", ".cc", ".hpp",
  ".cs", ".php", ".pl", ".pm", ".sh", ".bash", ".erl", ".hrl", ".jl", ".swift", ".scala",
  ".hs", ".lhs", ".sol", ".zig", ".nim", ".v", ".gleam", ".purs", ".haxe", ".cu", ".ml",
  ".cly", ".purs", ".d", ".ps1", ".tf", ".hcl", ".nix", ".elm", ".re", ".starlark",
])
const SKIP = new Set([".git", "node_modules", "target", "vendor", "dist", "build", "coverage", "__pycache__", ".tox"])

function collectSources(root: string): Array<{ p: string; text: string }> {
  const out: Array<{ p: string; text: string }> = []
  ;(function walk(dir: string) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue }
      if (!SRC_EXT.has(path.extname(e.name).toLowerCase())) continue
      let st
      try { st = statSync(p) } catch { continue }
      if (st.size > 3_000_000) continue
      try { out.push({ p: path.relative(root, p), text: readFileSync(p, "utf8") }) } catch {}
    }
  })(root)
  return out
}

// A consuming position: a call, a qualified access, a subscript. /g is REQUIRED
// by matchAll — the first version of the r5 oracle omitted it and threw.
const CONSUMING = /\.([A-Za-z_][A-Za-z0-9_]*)\s*[(.\[]|([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
function consumptionIndex(sources: Array<{ p: string; text: string }>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const add = (name: string, file: string) => {
    let s = index.get(name)
    if (!s) { s = new Set(); index.set(name, s) }
    s.add(file)
  }
  for (const { p, text } of sources) {
    for (const m of text.matchAll(CONSUMING)) {
      if (m[1]) add(m[1], p)
      else if (m[2]) add(m[2], p)
    }
  }
  return index
}

function repoNameFor(pid: string): string | null {
  for (const r of readdirSync(CORPUS)) {
    const p = path.join(CORPUS, r)
    try {
      if (createHash("sha1").update(realpathSync(p)).digest("hex").slice(0, 40) === pid) return r
    } catch { /* unreadable corpus entry */ }
  }
  return null
}

const CORPORA: Array<{ pid: string; name: string; root: string; dataDir: string }> = []
for (const dataDir of dataDirs) {
  const dir = path.join(dataDir, "projects")
  if (!exists(dir)) continue
  for (const pid of readdirSync(dir)) {
    const dbPath = path.join(dir, pid, "brain.db")
    if (!exists(dbPath)) continue
    const name = repoNameFor(pid) ?? pid.slice(0, 10)
    CORPORA.push({ pid, name, root: path.join(CORPUS, name), dataDir })
  }
}

// THE ENGINE AND THE PROBE MUST READ THE SAME DIRECTORY.
//
// detectOrphans() resolves its database through bbProjectsDir(), which reads
// BB_DATA_DIR from the environment. This probe read its own file/symbol counts
// through `c.dataDir`. Those are two different directories the moment a corpus
// lives anywhere other than BB_DATA_DIR — and then the engine CREATES an empty
// brain.db in BB_DATA_DIR (better-sqlite3 does not fail on a missing file) and
// answers "0 candidates" beside a table row asserting 56,738 symbols. That is
// how eight complete indexes were reported as empty.
//
// So: this probe scans EXACTLY the one directory the engine will use, and
// asserts they agree before measuring anything. Multiple data directories are
// handled by running the probe once per directory, not by teaching it to guess
// which one the engine picked.
const ENGINE_DATA_DIR = process.env.BB_DATA_DIR
if (!ENGINE_DATA_DIR) {
  console.error("BB_DATA_DIR is not set — the engine would create its own empty database. source harness/corpus-env.sh")
  process.exit(2)
}
if (path.resolve(ENGINE_DATA_DIR) !== path.resolve(dataDirs[0] ?? "")) {
  console.error(`BB_DATA_DIR (${ENGINE_DATA_DIR}) is not the directory being scanned (${dataDirs[0]}). The engine and this probe would read different databases.`)
  process.exit(2)
}
for (const d of dataDirs) {
  if (path.resolve(d) !== path.resolve(ENGINE_DATA_DIR)) {
    console.error(`refusing to scan ${d}: the engine reads ${ENGINE_DATA_DIR}. Run this probe once per data directory instead of listing several.`)
    process.exit(2)
  }
}
console.log(`data directory: ${ENGINE_DATA_DIR} (the engine resolves its database from the same place)\n`)

// Deduplicate by projectId, then drop any project the indexer has not recorded
// as complete. BOTH were needed: the same projectId appeared twice because two
// data dirs were scanned, and the completeness check was previously inside the
// per-corpus body, so a project could be skipped by the guard and still print a
// table row on another pass — the table and the skip list disagreed, which is
// worse than either being wrong alone.
//
// The first run of this probe reported NINE of seventeen corpora as having zero
// orphan candidates while the language matrix was still writing those databases.
// probe-l2 then found 1,237 candidates in `cue` and 2,942 in `terraform` on the
// same files. A partially-written index and a project with no dead code produce
// identical output; only brain_index_status, which the indexer writes when a run
// finishes, tells them apart.
// The same projectId appeared in TWO data directories, and the copy with more
// data was not the one being opened. `_data2_poly` had accumulated 2.1 MB empty
// schema stubs for every project in `_data_lang`; scanning `_data2_poly` first
// and deduplicating by pid therefore silently selected the EMPTY copy, and the
// probe reported ten complete, real indexes as having no rows at all.
//
// The dedup must choose on MEASURED DATA, never on directory order. For each pid
// the probe keeps the copy with the most indexed files, and says so when more
// than one exists — a choice between two answers has to be visible, or a later
// reader cannot tell which one was used.
const byPid = new Map<string, typeof CORPORA[number]>()
const shadowed: Array<{ pid: string; name: string; kept: string; dropped: string }> = []
for (const c of CORPORA) {
  const dbPath = path.join(c.dataDir, "projects", c.pid, "brain.db")
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const n = db.prepare("SELECT COUNT(*) n FROM brain_file").get() as { n: number }
  db.close()
  const prev = byPid.get(c.pid)
  if (!prev) { byPid.set(c.pid, c); continue }
  const dbPrev = new Database(path.join(prev.dataDir, "projects", prev.pid, "brain.db"), { readonly: true, fileMustExist: true })
  const nPrev = dbPrev.prepare("SELECT COUNT(*) n FROM brain_file").get() as { n: number }
  dbPrev.close()
  const keep = n.n > nPrev.n ? c : prev
  const drop = keep === c ? prev : c
  byPid.set(c.pid, keep)
  shadowed.push({ pid: c.pid, name: c.name, kept: `${keep.dataDir}(${Math.max(n.n, nPrev.n)})`, dropped: `${drop.dataDir}(${Math.min(n.n, nPrev.n)})` })
}

// Then drop anything the indexer has not recorded as complete.
const skipped: Array<{ name: string; why: string }> = []
const eligible: typeof CORPORA = []
for (const c of byPid.values()) {
  const dbPath = path.join(c.dataDir, "projects", c.pid, "brain.db")
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const n = db.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id = ?").get(c.pid) as { n: number }
  const status = db.prepare("SELECT status, indexed_files, total_files FROM brain_index_status WHERE project_id = ?").get(c.pid) as
    { status: string; indexed_files: number; total_files: number } | undefined
  db.close()
  if (n.n === 0) { skipped.push({ name: c.name, why: `no brain_file rows in ${dbPath}` }); continue }
  if (!status) { skipped.push({ name: c.name, why: "no brain_index_status row — the indexer never recorded a finished run" }); continue }
  if (status.status !== "complete") {
    skipped.push({ name: c.name, why: `status=${status.status} ${status.indexed_files}/${status.total_files}` })
    continue
  }
  eligible.push(c)
}
CORPORA.length = 0
CORPORA.push(...eligible)
if (shadowed.length) {
  console.log("duplicate projectIds across data dirs; the copy with more data was used:")
  for (const s2 of shadowed) console.log(`   ${s2.name} (${s2.pid.slice(0, 10)}): kept ${s2.kept}, ignored ${s2.dropped}`)
  console.log("")
}
CORPORA.sort((a, b) => a.name.localeCompare(b.name))
console.log(`${CORPORA.length} corpora across ${[...new Set(dataDirs)].length} data dir(s)\n`)

const rows: Array<Record<string, unknown>> = []
console.log(
  "repo           langs       files   syms   cands  FP%   disclosed  nonCode%  ms",
)
console.log(
  "".padEnd(62) + "---- ----- ----- ----- --- ---------- ------- ------ ----",
)

for (const c of CORPORA) {
  const db = new Database(path.join(c.dataDir, "projects", c.pid, "brain.db"), { readonly: true, fileMustExist: true })
  const files = db.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id=?").get(c.pid) as { n: number }
  const symbols = db.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id=?").get(c.pid) as { n: number }
  if (files.n === 0) { db.close(); continue }
  const langs = db.prepare(
    "SELECT language l, COUNT(*) n FROM brain_file WHERE project_id=? GROUP BY language ORDER BY n DESC LIMIT 3"
  ).all(c.pid) as Array<{ l: string; n: number }>
  const langLabel = langs.map((l) => l.l).join("/").slice(0, 10)

  const dup = new Set(db.prepare(
    "SELECT name FROM brain_symbol WHERE project_id=? AND symbol_type IN ('function','method','class','interface','struct','enum') GROUP BY name HAVING COUNT(*)>1",
  ).all(c.pid).map((r) => r.name))
  const nonCodeFileIds = new Set(db.prepare(
    "SELECT id FROM brain_file WHERE project_id=? AND " +
    (() => { const p = [...NON_CODE].map(() => "?").join(","); return `LOWER(COALESCE(language,'')) IN (${p})` })()
  ).all(c.pid, ...NON_CODE).map((r: any) => r.id))

  const t0 = process.hrtime.bigint()
  const report = await detectOrphans(c.pid, { minConfidence: 0, maxResults: 1_000_000 })
  const ms = Number(process.hrtime.bigint() - t0) / 1e6

  const syms = report.findings.filter((f) => f.rule !== "orphaned_file")
  const disclosed = syms.filter((f) =>
    f.evidence.some((e) => e.description.includes("REFUSED EVIDENCE") || e.description.includes("COVERAGE GAP INDICATOR")) ||
    f.limitations.some((l) => /probably the analyzer's/.test(l)),
  ).length
  const nonCode = syms.filter((f) => nonCodeFileIds.has((db.prepare("SELECT id FROM brain_file WHERE project_id=? AND relative_path=?").get(c.pid, f.location.file) as any)?.id)).length

  // Source-truth FP: a uniquely-named candidate consumed in another file.
  let fp = 0
  let usable = false
  if (c.root && exists(c.root)) {
    const sources = collectSources(c.root)
    if (sources.length >= 5) {
      usable = true
      const consumption = consumptionIndex(sources)
      fp = syms.filter((f) => {
        if (dup.has(f.location.symbol)) return false
        const hit = consumption.get(f.location.symbol)
        if (!hit) return false
        for (const p of hit) if (p !== f.location.file) return true
        return false
      }).length
    }
  }
  const uv: any = (report.summary as any)?.unverifiedUsageEdges

  rows.push({
    repo: c.name, langs: langLabel, files: files.n, syms: symbols.n, cands: syms.length,
    fp, fpPct: syms.length ? ((fp / syms.length) * 100).toFixed(1) : "-",
    disclosed, nonCode, nonCodePct: syms.length ? ((nonCode / syms.length) * 100).toFixed(1) : "-",
    ms: Math.round(ms), uv: uv?.total ?? 0, usable,
  })

  console.log(
    `${c.name.padEnd(13)} ${langLabel.padEnd(11)} ${String(files.n).padStart(5)} ${String(symbols.n).padStart(6)} ${String(syms.length).padStart(6)} ` +
    `${String(usable ? ((fp / Math.max(1, syms.length)) * 100).toFixed(1) : "-").padStart(4)}% ${String(disclosed).padStart(9)} ` +
    `${String(syms.length ? ((nonCode / syms.length) * 100).toFixed(1) : "-").padStart(7)}% ${String(Math.round(ms)).padStart(5)}`
  )
  db.close()
}

// ---------------------------------------------------------------- verdict
console.log("\n=== verdict ===")
const scored = rows.filter((r) => r.usable && (r.cands as number) > 0)
const worstFp = scored.length ? Math.max(...scored.map((r) => r.fpPct as number)) : 0
const worstNonCode = rows.length ? Math.max(...rows.map((r) => (r.cands as number) ? Number(r.nonCodePct) : 0)) : 0
const silent = rows.filter((r) => (r.cands as number) === 0)
const slow = rows.filter((r) => (r.ms as number) > 30_000)
const allLangs = new Set(rows.flatMap((r) => String(r.langs).split("/")))

console.log(`languages exercised      : ${[...allLangs].filter((l) => l && l !== "null").length} distinct`)
console.log(`corpora scored           : ${scored.length} of ${rows.length} (a corpus needs >= 5 source files for the text oracle)`)
console.log(`worst symbol FP rate     : ${worstFp}%  (a LOWER bound: the oracle cannot see reflection, string lookup or templates)`)
console.log(`worst non-code share     : ${worstNonCode}%  (the language gate should hold this near 0)`)
console.log(`corpora with 0 candidates: ${silent.length} ${silent.map((r) => r.repo).join(", ") || ""}`)
console.log(`corpora over 30s         : ${slow.length} ${slow.map((r) => `${r.repo}=${r.ms}ms`).join(", ") || ""}`)
console.log(`refused evidence rows    : ${rows.reduce((a, r) => a + (r.uv as number), 0)} total across the corpus`)
console.log(`corpora skipped as incomplete: ${skipped.length} ${skipped.map((s) => `${s.name}(${s.why})`).join("; ")}`)

let failures = 0
function want(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
console.log("\n=== assertions ===")
want("the language gate holds: no corpus is mostly non-code", worstNonCode <= 5, `${worstNonCode}%`)
want("the text oracle scored most corpora", scored.length >= Math.max(2, rows.length - 2), `${scored.length}/${rows.length}`)
want("at least 8 corpora were measured", rows.length >= 8, `${rows.length} measured, ${skipped.length} skipped as incomplete`)
want("the worst symbol FP rate stays under 30%", worstFp < 30, `${worstFp}%`)
want("no corpus takes over 30s to scan", slow.length === 0, slow.map((r) => String(r.repo)).join(","))
want("every corpus produced findings OR reports zero scanned symbols (not a silent zero)",
  silent.every((r) => (r.syms as number) === 0), silent.map((r) => `${r.repo}:${r.syms}syms`).join(","))
process.exit(failures > 0 ? 1 : 0)
