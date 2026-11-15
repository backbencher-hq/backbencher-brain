// bb_tests/bb_patterns/probes/probe-p2-orphan-file-truth.mjs
// P2 — the decisive orphaned_file experiment.
//
// THE QUESTION: detectOrphans reports a file orphaned iff (a) no resolved
// cross-file USAGE edge points at a symbol in it AND (b) no `imports`
// specifier shares its basename stem. P1 showed (b) is a name heuristic that
// mislabels 19% of the corpus. This file tests (a), which the subagent review
// claims can only ever be satisfied by SIX symbol types:
//
//   orphans.ts:74-80   symbols = ... WHERE symbol_type IN
//                      ('function','method','class','interface','struct','enum')
//   orphans.ts:99      symbolFileById = new Map(symbols.map(s => [s.id, s.fileId]))
//   orphans.ts:106-107 srcFile = symbolFileById.get(row.src); tgtFile = ....get(row.tgt)
//
// Both endpoints are looked up in a map built ONLY from those six types, so any
// file whose cross-file usage runs through a constant/property/type/variable is
// unreachable as "referenced" and gets reported orphaned.
//
// ORACLE: the same cross-file-usage question, asked over EVERY symbol type.
// A file the six-type engine calls orphaned but the all-type oracle says is
// referenced cross-file is a false positive, and the gap is a measurement of
// exactly the restriction being claimed.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const projectId = process.argv[2]
const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", projectId, "brain.db"), { readonly: true, fileMustExist: true })

const USAGE_TYPES = ["calls", "instantiates", "extends", "implements", "uses"]
const ph = USAGE_TYPES.map(() => "?").join(",")

// All symbol -> file, regardless of type.
const allSymFile = db.prepare("SELECT s.id, s.file_id AS fid, s.symbol_type AS st FROM brain_symbol s WHERE s.project_id = ?").all(projectId)
const fileOfSym = new Map(allSymFile.map((r) => [r.id, r.fid]))

// (1) The engine's own evidence set: BOTH endpoints restricted to six types.
const sixTypes = new Set(["function", "method", "class", "interface", "struct", "enum"])
const engineFileOfSym = new Map()
for (const r of allSymFile) if (sixTypes.has(r.st)) engineFileOfSym.set(r.id, r.fid)

// (2) The oracle: either endpoint may be ANY type.
const rows = db.prepare(
  `SELECT r.source_symbol_id AS src, r.target_symbol_id AS tgt, r.relationship_type AS rt
     FROM brain_relationship r
    WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL AND r.source_symbol_id IS NOT NULL
      AND r.relationship_type IN (${ph})`
).all(projectId, ...USAGE_TYPES)

const engineReferenced = new Set()
const oracleReferenced = new Set()
let engineEdges = 0
let oracleOnlyEdges = 0
const oracleOnlyByType = {}
const typeOfSym = new Map(allSymFile.map((r) => [r.id, r.st]))

for (const row of rows) {
  const tAll = fileOfSym.get(row.tgt)
  const sAll = fileOfSym.get(row.src)
  if (tAll && sAll && sAll !== tAll) oracleReferenced.add(tAll)
  const tSix = engineFileOfSym.get(row.tgt)
  const sSix = engineFileOfSym.get(row.src)
  if (tSix && sSix && sSix !== tSix) {
    engineReferenced.add(tSix)
    engineEdges++
  } else {
    oracleOnlyEdges++
    const st = typeOfSym.get(row.tgt) ?? "(target symbol not in index)"
    oracleOnlyByType[st] = (oracleOnlyByType[st] ?? 0) + 1
  }
}

// Now the engine's actual orphaned_file verdict. Reproduce its two channels
// exactly (P1 already validated the import-tail channel) and compare.
const importRows = db.prepare("SELECT target_external AS ext FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports'").all(projectId)
const importedTails = new Set()
for (const r of importRows) {
  if (!r.ext) continue
  const spec = r.ext.split(":")[0] ?? r.ext
  importedTails.add(spec.split("/").pop()?.replace(/\.[^.]+$/, "") ?? spec)
}

const NOISE = new Set(["baselines","snapshots","__snapshots__","__generated__","generated","gen","fixtures","node_modules","vendor","dist","build","coverage","__pycache__"])
const TEST_SEG = new Set(["test","tests","__tests__","spec","specs","e2e"])
function isHardNoise(p) {
  const l = p.toLowerCase()
  if (/\.d\.[a-z]+$/.test(l) || /\.(min|-min)\.[a-z]+$/.test(l) || /\.(bundle|chunk)\.[a-z]+$/.test(l) || /\.map$/.test(l)) return true
  return l.split("/").some((s) => NOISE.has(s))
}
function isTestPath(p) {
  const base = p.split("/").pop() ?? p
  const lower = base.toLowerCase()
  if (lower.includes(".test.") || lower.includes(".spec.")) return true
  if (lower.startsWith("test_") || lower.startsWith("spec_")) return true
  if (/(_test|_spec)\.[a-z]+$/.test(lower)) return true
  const dot = lower.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  if (/Tests?$/.test(stem)) return true
  return p.split("/").some((s) => TEST_SEG.has(s.toLowerCase()))
}

const files = db.prepare("SELECT id, relative_path AS p, line_count AS lc FROM brain_file WHERE project_id = ?").all(projectId)
const engineOrphanFiles = []
for (const f of files) {
  if (isTestPath(f.p)) continue
  if (isHardNoise(f.p)) continue
  const base = f.p.split("/").pop()?.replace(/\.[^.]+$/, "") ?? f.p
  if (["index", "main", "app", "mod"].includes(base.toLowerCase())) continue
  if (engineReferenced.has(f.id)) continue
  if (importedTails.has(base)) continue
  engineOrphanFiles.push(f)
}

console.log(`usage edges examined              : ${rows.length}`)
console.log(`edges usable by the 6-type engine : ${engineEdges}`)
console.log(`edges INVISIBLE to the 6-type rule: ${oracleOnlyEdges}`)
console.log(`  invisible because target symbol type is:`)
for (const [t, c] of Object.entries(oracleOnlyByType).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`     ${String(c).padStart(6)}  ${t}`)
console.log()
console.log(`files the engine reports orphaned_file : ${engineOrphanFiles.length}`)
const falsePositives = engineOrphanFiles.filter((f) => oracleReferenced.has(f.id))
console.log(`...of which the all-type oracle says ARE referenced cross-file : ${falsePositives.length}`)
console.log(`   => orphan-file false-positive rate : ${((falsePositives.length / Math.max(1, engineOrphanFiles.length)) * 100).toFixed(1)}%`)
console.log()
console.log("--- sample FALSE POSITIVES (a real incoming cross-file usage edge exists) ---")
for (const f of falsePositives.slice(0, 25)) console.log(`   ${f.p}  (${f.lc ?? "?"} lines)`)
console.log()
console.log("--- of those, how many are under src/ (real source, not docs/yml) ---")
console.log("   " + JSON.stringify(tally(falsePositives.map((f) => f.p.split("/")[0]))))
console.log("   " + JSON.stringify(tally(falsePositives.map((f) => (path.extname(f.p) || "(none)")))))
console.log()
console.log("--- sample TRUE orphans (neither channel finds a reference) ---")
for (const f of engineOrphanFiles.filter((f) => !oracleReferenced.has(f.id)).slice(0, 20)) console.log(`   ${f.p}`)

function tally(xs) {
  const o = {}
  for (const x of xs) o[x] = (o[x] ?? 0) + 1
  return o
}
db.close()
