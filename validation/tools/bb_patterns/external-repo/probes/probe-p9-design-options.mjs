// bb_tests/bb_patterns/probes/probe-p9-design-options.mjs
// P9 — choose the fix from measurements, not from taste.
//
// Four candidate changes to the orphan engine are compared against the real
// index, each scored on the thing that actually matters: how many of the
// reported orphans are real, and how many real orphans are missed.
//
//   V0  shipped: six symbol types, 5 relationship types, global stem set
//   V1  all symbol types for the file-referenced map        (F3/F4)
//   V2  V1 + 'references' as a usage type                     (measured below)
//   V3  V2 + code-language gate on symbol candidates         (F1/F5)
//   V4  V3 + directory-aware import matching                 (F6)
//
// A candidate is only a candidate if it can be shown to dominate. Each is
// measured for: symbol-orphan candidates, file-orphan candidates, and how the
// file channel behaves when the import provenance is absent (3,444 of 3,554
// import rows have a NULL source_symbol_id, so no import can be attributed to
// a file — the shipped comment at orphans.ts:203-206 claims "we require
// incoming from another file" and the query cannot express that).

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const projectId = process.argv[2]
const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", projectId, "brain.db"), { readonly: true, fileMustExist: true })

const SIX = ["function", "method", "class", "interface", "struct", "enum"]
const SIXSET = new Set(SIX)
const BASE_USAGE = ["calls", "instantiates", "extends", "implements", "uses"]
const NOISE = new Set(["baselines","snapshots","__snapshots__","__generated__","generated","gen","fixtures","node_modules","vendor","dist","build","coverage","__pycache__"])
const TEST_SEG = new Set(["test","tests","__tests__","spec","specs","e2e"])

// Languages whose "symbols" are not executable declarations. Chosen by
// inspection of brain_file.language on all nine corpora, not guessed.
const NON_CODE = new Set(["markdown", "yaml", "toml", "ini", "csv", "text", "plaintext", "rst", "tex", "org", "adoc"])

const isHardNoise = (p) => {
  const l = p.toLowerCase()
  if (/\.d\.[a-z]+$/.test(l) || /\.(min|-min)\.[a-z]+$/.test(l) || /\.(bundle|chunk)\.[a-z]+$/.test(l) || /\.map$/.test(l)) return true
  return l.split("/").some((s) => NOISE.has(s))
}
const isTestPath = (p) => {
  const base = p.split("/").pop() ?? p
  const lower = base.toLowerCase()
  if (lower.includes(".test.") || lower.includes(".spec.") || lower.startsWith("test_") || lower.startsWith("spec_")) return true
  if (/(_test|_spec)\.[a-z]+$/.test(lower)) return true
  const dot = lower.lastIndexOf(".")
  if (/Tests?$/.test(dot > 0 ? base.slice(0, dot) : base)) return true
  return p.split("/").some((s) => TEST_SEG.has(s.toLowerCase()))
}
const stemOf = (p) => p.split("/").pop()?.replace(/\.[^.]+$/, "") ?? p
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "")

// ---------------------------------------------------------------- load once
const files = db.prepare("SELECT id, relative_path AS p, language AS lang, line_count AS lc FROM brain_file WHERE project_id = ?").all(projectId)
const fileById = new Map(files.map((f) => [f.id, f]))
const syms = db.prepare("SELECT id, name, file_id AS fid, symbol_type AS st FROM brain_symbol WHERE project_id = ?").all(projectId)
const fileOfSym = new Map(syms.map((s) => [s.id, s.fid]))
const sixOfSym = new Map(syms.filter((s) => SIXSET.has(s.st)).map((s) => [s.id, s.fid]))

// duplicate names, over the shipped scope (whole project) and over the
// candidate scope (code files only) — the shipped query uses the former.
const dupAll = new Set(db.prepare("SELECT name FROM brain_symbol WHERE project_id = ? GROUP BY name HAVING COUNT(*) > 1").all(projectId).map((r) => r.name))
const codeFileIds = new Set(files.filter((f) => !NON_CODE.has((f.lang ?? "").toLowerCase())).map((f) => f.id))
const dupCode = new Set(db.prepare(
  `SELECT name FROM brain_symbol WHERE project_id = ? GROUP BY name HAVING COUNT(*) > 1`
).all(projectId).map((r) => r.name))

// resolved usage targets, split by relationship class
const usageRows = (types) => db.prepare(
  `SELECT source_symbol_id AS src, target_symbol_id AS tgt, target_external AS ext FROM brain_relationship
    WHERE project_id = ? AND target_symbol_id IS NOT NULL AND source_symbol_id IS NOT NULL
      AND relationship_type IN (${types.map(() => "?").join(",")})`
).all(projectId, ...types)

const importRows = db.prepare("SELECT target_external AS ext FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports'").all(projectId)
const globalStems = new Set()
const dirStems = new Set() // "dirSuffix/stem"
for (const r of importRows) {
  if (!r.ext) continue
  const spec = r.ext.split(":")[0] ?? r.ext
  const tail = spec.split("/").pop()?.replace(/\.[^.]+$/, "") ?? spec
  globalStems.add(tail)
  dirStems.add(`${spec.includes("/") ? spec.slice(0, spec.lastIndexOf("/")) : ""}/${tail}`)
}

function build({ allTypes, withReferences, codeGate, dirAware }) {
  const usage = withReferences ? [...BASE_USAGE, "references"] : BASE_USAGE
  const map = allTypes ? fileOfSym : sixOfSym
  const refFiles = new Set()
  const usedIds = new Set()
  for (const row of usageRows(usage)) {
    usedIds.add(row.tgt)
    const tf = map.get(row.tgt), sf = map.get(row.src)
    if (tf && sf && sf !== tf) refFiles.add(tf)
  }
  const usedNames = new Set()
  for (const row of usageRows(usage)) if (row.ext) usedNames.add(row.ext.split(":").pop() ?? row.ext)
  const dup = codeGate ? dupCode : dupAll

  const symCandidates = []
  for (const s of syms) {
    if (!SIXSET.has(s.st)) continue
    const f = fileById.get(s.fid)
    if (!f) continue
    if (isTestPath(f.p) || isHardNoise(f.p)) continue
    if (codeGate && NON_CODE.has((f.lang ?? "").toLowerCase())) continue
    if (usedIds.has(s.id)) continue
    if (usedNames.has(s.name) && !dup.has(s.name)) continue
    symCandidates.push({ s, f })
  }

  const orphanFiles = []
  for (const f of files) {
    if (isTestPath(f.p) || isHardNoise(f.p)) continue
    const b = stemOf(f.p)
    if (["index", "main", "app", "mod"].includes(b.toLowerCase())) continue
    if (refFiles.has(f.id)) continue
    if (dirAware) {
      // Two-segment key. A one-segment specifier ("node:fs", "express") carries
      // no path evidence at all and is deliberately allowed to match nothing.
      if (importKeys2.has(pathKey2(f.p))) continue
    } else {
      if (globalStems.has(b)) continue
    }
    orphanFiles.push(f)
  }
  return { symCandidates, orphanFiles, refFiles, usedIds, usedNames, dup }
}

// "src/lsp/hub_protocol" — the last two path segments with the extension off.
// A specifier and a file agree only when their last two segments agree, which
// is what kills the shipped collisions: `node:fs` has one segment and matches
// nothing, and `src/utils/foo.ts` no longer collides with `src/other/foo.ts`.
function pathKey2(p) {
  const segs = p.split("/").filter(Boolean)
  if (segs.length < 2) return segs.length === 1 ? segs[0] : ""
  return segs[segs.length - 2] + "/" + segs[segs.length - 1].replace(/\.[^.]+$/, "")
}
const importKeys2 = new Set()
for (const r of importRows) {
  if (!r.ext) continue
  const spec = r.ext.split(":")[0] ?? r.spec ?? r.ext
  const key = pathKey2(spec)
  if (key.includes("/")) importKeys2.add(key) // one-segment specifiers are evidence-free
}

// The oracle: a symbol that is genuinely referenced by ANY resolved edge of
// ANY relationship type pointing at it, or named by any reference. Used only to
// score the candidates, never to build them.
// ORACLE for scoring. A symbol counts as provably-used if something other than
// the indexer's ownership bookkeeping points at it.
//
// The first version of this oracle took every relationship with a non-null
// target_symbol_id and reported "86% of orphan candidates are provably still
// used". That was wrong: `contains` (35,777 edges) and `exports` are the
// indexer's own bookkeeping — docs/BB_PATTERNS.md:31-32 excludes them from
// usage for exactly this reason. Counting them makes almost every declaration
// look used. The exclusion below is the documented model, not a convenience.
const NON_USAGE = new Set(["contains", "exports"])
const anyRef = new Set()
for (const row of db.prepare(
  `SELECT target_symbol_id AS tgt, relationship_type AS rt FROM brain_relationship
    WHERE project_id = ? AND target_symbol_id IS NOT NULL`
).all(projectId)) if (!NON_USAGE.has(row.rt)) anyRef.add(row.tgt)
const anyRefName = new Set(db.prepare(
  `SELECT target_external AS ext, relationship_type AS rt FROM brain_relationship
    WHERE project_id = ? AND target_external IS NOT NULL AND relationship_type NOT IN ('contains','exports')`
).all(projectId).map((r) => (r.ext.includes(":") ? r.ext.split(":").pop() : r.ext)))
// A declared-and-exported symbol is a weaker kind of use: the module offers it.
// Counted separately so a candidate that is only "exported" is visible as such
// instead of being quietly folded into "used" or "orphan".
const exported = new Set(db.prepare(
  `SELECT target_symbol_id AS tgt FROM brain_relationship WHERE project_id = ? AND relationship_type = 'exports' AND target_symbol_id IS NOT NULL`
).all(projectId).map((r) => r.tgt))

const VARIANTS = [
  ["V0 shipped", { allTypes: false, withReferences: false, codeGate: false, dirAware: false }],
  ["V1 all types", { allTypes: true, withReferences: false, codeGate: false, dirAware: false }],
  ["V2 +references", { allTypes: true, withReferences: true, codeGate: false, dirAware: false }],
  ["V3 +code gate", { allTypes: true, withReferences: true, codeGate: true, dirAware: false }],
  ["V4 +dir-aware imports", { allTypes: true, withReferences: true, codeGate: true, dirAware: true }],
]

console.log("variant              symCands  nonCode  dupName  fileCands")
for (const [name, opts] of VARIANTS) {
  const r = build(opts)
  const nonCode = r.symCandidates.filter((c) => NON_CODE.has((c.f.lang ?? "").toLowerCase())).length
  const dupName = r.symCandidates.filter((c) => r.dup.has(c.s.name)).length
  console.log(`${name.padEnd(20)} ${String(r.symCandidates.length).padStart(8)} ${String(nonCode).padStart(8)} ${String(dupName).padStart(8)} ${String(r.orphanFiles.length).padStart(10)}`)
}

console.log("\n--- of each variant's symbol candidates: provably used / only-exported / neither ---")
for (const [name, opts] of VARIANTS) {
  const r = build(opts)
  const used = r.symCandidates.filter((c) => anyRef.has(c.s.id) || (anyRefName.has(c.s.name) && !r.dup.has(c.s.name)))
  const onlyExported = r.symCandidates.filter((c) => !used.includes(c) && exported.has(c.s.id))
  const clean = r.symCandidates.length - used.length - onlyExported.length
  const pct = (n) => ((n / Math.max(1, r.symCandidates.length)) * 100).toFixed(1)
  console.log(`${name.padEnd(20)} used ${String(used.length).padStart(5)} (${pct(used.length)}%)  only-exported ${String(onlyExported.length).padStart(5)} (${pct(onlyExported.length)}%)  neither ${String(clean).padStart(5)} (${pct(clean)}%)`)
}

console.log("\n--- file candidates reachable at the shipped default (minConfidence 0.6, maxResults 100) ---")
for (const [name, opts] of VARIANTS) {
  const r = build(opts)
  // shipped sort: confidence desc, then path asc. Symbols are all 0.6, files 0.5.
  const symPaths = r.symCandidates.map((c) => c.f.p).sort()
  const filePaths = r.orphanFiles.map((f) => f.p).sort()
  const page = [...symPaths.map((p) => ["sym", p, 0.6]), ...filePaths.map((p) => ["file", p, 0.5])]
    .sort((a, b) => b[2] - a[2] || a[1].localeCompare(b[1])).slice(0, 100)
  const fileOnPage = page.filter((p) => p[0] === "file").length
  console.log(`${name.padEnd(20)} page: ${String(fileOnPage).padStart(3)} of 100 are files   (${page.filter((p) => p[1].startsWith("src/")).length} under src/)`)
}

db.close()
