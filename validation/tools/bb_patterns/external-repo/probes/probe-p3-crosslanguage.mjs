// bb_tests/bb_patterns/probes/probe-p3-crosslanguage.mjs
// P3 — the same orphaned_file experiment (P2) across NINE real repositories in
// eight languages, so no single language's import style decides the verdict.
//
// Repos are real clones under bb_tests/repositories/, indexed by a concurrent
// lane and copied into this lane's BB_DATA_DIR. Nothing here is synthesized.
//
//   rake        Ruby       clojure    Clojure   lodash     JavaScript
//   rebar3      Erlang     luarocks   Lua       mojo       Mojo
//   ripgrep     Rust       clyde      Python     + backbencher-brain (TS)
//
// P2 predicted that the import-tail heuristic is a JavaScript/TypeScript shape
// and mislabels everything else, because a Python relative specifier
// ('.models:User') and a Clojure/Python dotted module ('mypkg.helpers:x') are
// both mangled by `split(':')[0]` then `strip a trailing .ext`. This measures
// it per language rather than arguing it from the source.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const CORPUS = "/Users/sano/Documents/Default Project/ishaq/bb_tests/repositories"
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")

const USAGE_TYPES = ["calls", "instantiates", "extends", "implements", "uses"]
const SIX = new Set(["function", "method", "class", "interface", "struct", "enum"])
const NOISE = new Set(["baselines","snapshots","__snapshots__","__generated__","generated","gen","fixtures","node_modules","vendor","dist","build","coverage","__pycache__"])
const TEST_SEG = new Set(["test","tests","__tests__","spec","specs","e2e"])

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
const stem = (p) => p.split("/").pop()?.replace(/\.[^.]+$/, "") ?? p

// Replays orphans.ts:74-80, :99, :106-108, :207-227 exactly.
function analyze(db, projectId) {
  const syms = db.prepare("SELECT s.id, s.file_id AS fid, s.symbol_type AS st FROM brain_symbol s WHERE s.project_id = ?").all(projectId)
  const fileOfSym = new Map(syms.map((r) => [r.id, r.fid]))
  const sixOfSym = new Map()
  for (const r of syms) if (SIX.has(r.st)) sixOfSym.set(r.id, r.fid)

  const ph = USAGE_TYPES.map(() => "?").join(",")
  const edges = db.prepare(
    `SELECT source_symbol_id AS src, target_symbol_id AS tgt FROM brain_relationship
      WHERE project_id = ? AND target_symbol_id IS NOT NULL AND source_symbol_id IS NOT NULL
        AND relationship_type IN (${ph})`
  ).all(projectId, ...USAGE_TYPES)

  const engineRef = new Set()
  const oracleRef = new Set()
  let usable = 0
  for (const e of edges) {
    const ta = fileOfSym.get(e.tgt), sa = fileOfSym.get(e.src)
    if (ta && sa && sa !== ta) oracleRef.add(ta)
    const ts = sixOfSym.get(e.tgt), ss = sixOfSym.get(e.src)
    if (ts && ss && ss !== ts) { engineRef.add(ts); usable++ }
  }

  const importRows = db.prepare("SELECT target_external AS ext FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports'").all(projectId)
  const tails = new Set()
  let emptyTail = 0
  for (const r of importRows) {
    if (!r.ext) continue
    const spec = r.ext.split(":")[0] ?? r.ext
    const t = spec.split("/").pop()?.replace(/\.[^.]+$/, "") ?? spec
    if (t === "") emptyTail++
    tails.add(t)
  }

  const files = db.prepare("SELECT id, relative_path AS p FROM brain_file WHERE project_id = ?").all(projectId)
  const orphanFiles = []
  const suppressedByName = []
  for (const f of files) {
    if (isTestPath(f.p) || isHardNoise(f.p)) continue
    const b = stem(f.p)
    if (["index", "main", "app", "mod"].includes(b.toLowerCase())) continue
    if (engineRef.has(f.id)) continue
    if (tails.has(b)) { suppressedByName.push(f.p); continue }
    orphanFiles.push(f)
  }
  const fps = orphanFiles.filter((f) => oracleRef.has(f.id))
  return { syms, files, edges, usable, orphanFiles, fps, suppressedByName, importRows, emptyTail, tails }
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((s) => { const [pid, label] = s.split("="); return { pid, label: label ?? pid.slice(0, 8) } })
  : [
      { pid: "818db37d8f54173ad1357ab24627373da2e9418c", label: "backbencher-brain" },
      { pid: "46899d917deda24dd6a87aa99272878828b5cc94", label: "rake" },
      { pid: "f213db69a303c1cc62a974e69eaeb81d6f2da47d", label: "rebar3" },
      { pid: "98957b6e63fb89df308a2d264c8e4d86a0eebf9a", label: "ripgrep" },
      { pid: "d039ac4f840b536081414d0fc287a1e3fd7e80ee", label: "lodash" },
      { pid: "78cdd571a4cbfa21b686996fbb9167230d68fea0", label: "clojure" },
      { pid: "833a9b16d03d794e6d3c93c6faace310b2fab523", label: "clyde" },
      { pid: "59a0901a13fcda04595a0813f3770598b4b9f633", label: "luarocks" },
      { pid: "ca5208e8e9ec7e310da7a799655bf5dcdfb1a3d4", label: "mojo" },
    ]

const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", targets[0].pid, "brain.db"), { readonly: true, fileMustExist: true })
// A second handle per project: better-sqlite3 caches per path.
const handleFor = (pid) => (pid === targets[0].pid ? db : new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true }))

const header = ["repo", "files", "syms", "edges", "edgesUsed", "edgesLost", "lost%", "imports", "emptyTail", "tailHit", "orphanFiles", "FP", "FP%", "nameSupp", "nameSupp%"]
console.log(header.join("\t"))
const rows = []
for (const t of targets) {
  const d = handleFor(t.pid)
  const a = analyze(d, t.pid)
  const lost = a.edges.length - a.usable
  rows.push({
    repo: t.label, files: a.files.length, syms: a.syms.length, edges: a.edges.length, edgesUsed: a.usable, edgesLost: lost,
    lostPct: ((lost / Math.max(1, a.edges.length)) * 100).toFixed(1),
    imports: a.importRows.length, emptyTail: a.emptyTail, tails: a.tails.size,
    orphanFiles: a.orphanFiles.length, fp: a.fps.length,
    fpPct: ((a.fps.length / Math.max(1, a.orphanFiles.length)) * 100).toFixed(1),
    nameSupp: a.suppressedByName.length,
    nameSuppPct: ((a.suppressedByName.length / Math.max(1, a.files.length)) * 100).toFixed(1),
  })
  d !== db && d.close()
}
for (const r of rows) console.log([r.repo, r.files, r.syms, r.edges, r.edgesUsed, r.edgesLost, r.lostPct, r.imports, r.emptyTail, r.tails, r.orphanFiles, r.fp, r.fpPct, r.nameSupp, r.nameSuppPct].join("\t"))
db.close()
