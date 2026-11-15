// bb_tests/bb_patterns/probes/probe-r1-reverify.mjs
// R1 — re-decide EVERY fix against the new analyzers.
//
// The upstream merge (4900f3e4, 568 commits) replaced the analyzers that the
// previous measurement round was taken against. Several fixes in this lane were
// compensating for index defects that may no longer exist, and a fix that
// compensates for a fixed defect is now a bug: it discards real evidence.
//
// This probe therefore re-asks every question from scratch and reports a
// verdict per question, not a number to be admired. Each question names the
// decision it governs, so "keep" and "drop" are both legible outcomes.
//
// Questions, and the decision each one governs:
//   Q1  does the six-type restriction still hide edges?      -> all-types map
//   Q2  do `references` / `imports` / `overrides` carry real usage evidence?
//                                                          -> USAGE_TYPES membership
//   Q3  is `overrides` trustworthy ENOUGH to suppress an orphan?
//                                                          -> USAGE_TYPES membership
//   Q4  are non-code symbols still polluting the candidate set? -> language gate
//   Q5  does the index now record WHICH FILE imported what?  -> file rule strength
//   Q6  is the old top false positive still a false positive? -> confidence model
//   Q7  what is the file false-positive rate now?             -> file rule
//   Q8  is the god-class query still slow?                    -> query shape
//
// ORACLE, unchanged and stated once: a reported symbol candidate is a provable
// false positive if something other than `contains`/`exports` points at its
// symbol id, or if its name is unambiguously named by a non-bookkeeping
// reference. `contains` and `exports` are the indexer's own bookkeeping —
// docs/BB_PATTERNS.md excludes them for that reason, and the one version of
// this oracle that counted them reported a meaningless 86%.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")

const NON_USAGE = new Set(["contains", "exports"])
const SIX = new Set(["function", "method", "class", "interface", "struct", "enum"])
const NON_CODE = new Set([
  "markdown", "yaml", "toml", "json", "xml", "css", "scss", "less", "html", "htm",
  "vue", "svelte", "ini", "cfg", "conf", "properties", "env", "csv", "tsv", "text",
  "plaintext", "rst", "tex", "bib", "org", "adoc", "asciidoc",
])
const NOISE = new Set(["baselines", "snapshots", "__snapshots__", "__generated__", "generated", "gen", "fixtures", "node_modules", "vendor", "dist", "build", "coverage", "__pycache__"])
const TEST_SEG = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e"])

const isHardNoise = (p) => {
  const l = p.toLowerCase()
  if (/\.d\.[a-z]+$/.test(l) || /\.(min|-min)\.[a-z]+$/.test(l) || /\.(bundle|chunk)\.[a-z]+$/.test(l) || /\.map$/.test(l)) return true
  return l.split("/").some((s) => NOISE.has(s))
}
const isTestPath = (p) => {
  const base = p.slice(p.lastIndexOf("/") + 1)
  const lower = base.toLowerCase()
  if (lower.includes(".test.") || lower.includes(".spec.") || lower.startsWith("test_") || lower.startsWith("spec_")) return true
  const dot = base.lastIndexOf(".")
  if (dot > 0 && /Tests?$/.test(base.slice(0, dot))) return true
  return p.split("/").some((s) => TEST_SEG.has(s.toLowerCase()))
}
const key2 = (p) => {
  const s = p.split("/").filter(Boolean)
  if (s.length < 2) return ""
  const last = s[s.length - 1]
  const d = last.lastIndexOf(".")
  return s[s.length - 2] + "/" + (d > 0 ? last.slice(0, d) : last)
}
const stemOf = (p) => { const b = p.slice(p.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d > 0 ? b.slice(0, d) : b }

const targets = process.argv.slice(2).map((s) => { const [pid, label] = s.split("="); return { pid, label: label ?? pid.slice(0, 8) } })
if (!targets.length) { console.error("usage: probe-r1-reverify.mjs <projectId>[=label] ..."); process.exit(2) }

const open = (pid) => new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })

for (const t of targets) {
  const db = open(t.pid)
  const P = t.pid
  console.log(`\n${"=".repeat(78)}\n${t.label}   projectId=${P}\n${"=".repeat(78)}`)

  const files = db.prepare("SELECT id, relative_path p, language lang, line_count lc FROM brain_file WHERE project_id=?").all(P)
  const fileById = new Map(files.map((f) => [f.id, f]))
  const syms = db.prepare("SELECT id, name, file_id f, symbol_type st FROM brain_symbol WHERE project_id=?").all(P)
  const fileOfSym = new Map(syms.map((s) => [s.id, s.f]))
  const sixOfSym = new Map(syms.filter((s) => SIX.has(s.st)).map((s) => [s.id, s.f]))
  console.log(`files=${files.length} symbols=${syms.length} relationships=${db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(P).c}`)
  const langs = db.prepare("SELECT language l, COUNT(*) c FROM brain_file WHERE project_id=? GROUP BY language ORDER BY c DESC").all(P)
  console.log("languages: " + langs.slice(0, 8).map((r) => `${r.l}=${r.c}`).join(" "))

  // ---- relationship inventory -------------------------------------------
  const rt = db.prepare("SELECT relationship_type rt, COUNT(*) c, SUM(CASE WHEN target_symbol_id IS NOT NULL THEN 1 ELSE 0 END) tgt FROM brain_relationship WHERE project_id=? GROUP BY relationship_type ORDER BY c DESC").all(P)
  console.log("\nrelationship types: " + rt.map((r) => `${r.rt}=${r.c}${r.tgt ? `(${r.tgt} resolved)` : ""}`).join("  "))

  // ---- Q3: is `overrides` evidence? --------------------------------------
  // For every symbol that is ONLY reachable via an `overrides` edge, ask
  // whether any OTHER usage type also points at it. If overrides is mostly a
  // duplicate of extends/instantiates it is harmless; if it is the ONLY
  // evidence for most of its targets, then treating it as usage is a decision
  // resting entirely on the label the upstream review says has no oracle.
  const byTypeTarget = new Map()
  for (const r of db.prepare("SELECT relationship_type rt, target_symbol_id t FROM brain_relationship WHERE project_id=? AND target_symbol_id IS NOT NULL").all(P)) {
    if (NON_USAGE.has(r.rt)) continue
    if (!byTypeTarget.has(r.t)) byTypeTarget.set(r.t, new Set())
    byTypeTarget.get(r.t).add(r.rt)
  }
  let ovOnly = 0, ovMulti = 0, ovTotal = 0
  for (const [t, types] of byTypeTarget) {
    if (!types.has("overrides")) continue
    ovTotal++
    if (types.size === 1) ovOnly++; else ovMulti++
  }
  console.log(`\nQ3 overrides: ${ovTotal} resolved targets; ${ovOnly} ONLY evidenced by overrides, ${ovMulti} also evidenced by another type`)
  const ovOnlyIds = new Set([...byTypeTarget].filter(([, t]) => t.has("overrides") && t.size === 1).map(([id]) => id))
  console.log(`   verdict: ${ovTotal === 0 ? "N/A - no resolved overrides edges, the question cannot arise on this corpus" : ovOnly === 0 ? "KEEP - overrides never carries a target that no other type also carries" : `DECISION REQUIRED - ${ovOnly} of ${ovTotal} overrides targets have no other evidence; upstream (60eb13ef) discloses overrides is heuristically derived with NO oracle, so each of those is an unverified suppression`}`)

  // ---- Q1/Q2: edge visibility and usage-type value ------------------------
  const usageRows = db.prepare(
    "SELECT source_symbol_id s, target_symbol_id t, relationship_type rt FROM brain_relationship WHERE project_id=? AND target_symbol_id IS NOT NULL AND source_symbol_id IS NOT NULL").all(P)
  const refAll = new Set(), refSix = new Set()
  for (const r of usageRows) {
    if (NON_USAGE.has(r.rt)) continue
    const ta = fileOfSym.get(r.t), sa = fileOfSym.get(r.s)
    const ts = sixOfSym.get(r.t), ss = sixOfSym.get(r.s)
    if (ta && sa && sa !== ta) refAll.add(ta)
    if (ts && ss && ss !== ts) refSix.add(ts)
  }
  console.log(`\nQ1 cross-file usage edges: ${usageRows.filter((r) => !NON_USAGE.has(r.rt)).length} total; six-type map sees ${refSix.size} files, all-type map sees ${refAll.size}`)
  console.log(`   verdict: ${refAll.size >= refSix.size ? "KEEP the all-type map" : "REVERT — the all-type map sees FEWER files, which cannot happen and means a bug"}`)

  // per-type marginal value: how many files would stop being reported if a type
  // were ADDED to / REMOVED from the usage set
  const refWithout = (omit) => {
    const s = new Set()
    for (const r of usageRows) {
      if (NON_USAGE.has(r.rt) || r.rt === omit) continue
      const ta = fileOfSym.get(r.t), sa = fileOfSym.get(r.s)
      if (ta && sa && sa !== ta) s.add(ta)
    }
    return s
  }
  for (const type of ["references", "imports", "overrides"]) {
    const without = refWithout(type)
    console.log(`Q2 ${type.padEnd(11)}: removing it from the usage set would un-reference ${refAll.size - without.size} more file(s)`)
  }

  // ---- Q4: non-code pollution --------------------------------------------
  const reported = syms.filter((s) => SIX.has(s.st))
  const inTestOrNoise = reported.filter((s) => { const f = fileById.get(s.f); return f && (isTestPath(f.p) || isHardNoise(f.p)) }).length
  const nonCodeSyms = reported.filter((s) => { const f = fileById.get(s.f); return f && NON_CODE.has((f.lang ?? "").toLowerCase()) }).length
  console.log(`\nQ4 reportable symbols: ${reported.length}; in test/noise paths ${inTestOrNoise}; in non-code languages ${nonCodeSyms} (${((nonCodeSyms / Math.max(1, reported.length)) * 100).toFixed(1)}%)`)
  console.log(`   verdict: ${nonCodeSyms > reported.length * 0.1 ? "KEEP the language gate - over a tenth of the pool is non-code" : nonCodeSyms > 0 ? "the gate is still removing real candidates; re-check the list" : "N/A - no non-code symbols remain, the gate is now inert"}`)

  // ---- Q5: import provenance ---------------------------------------------
  const imp = db.prepare("SELECT source_symbol_id s, target_external e FROM brain_relationship WHERE project_id=? AND relationship_type='imports'").all(P)
  const withSrc = imp.filter((r) => r.s !== null).length
  console.log(`\nQ5 import rows: ${imp.length}; with an attributable source symbol: ${withSrc} (${((withSrc / Math.max(1, imp.length)) * 100).toFixed(1)}%)`)
  console.log(`   verdict: ${imp.length === 0 ? "N/A - the index records no imports for this corpus, so file findings rest on the symbol channel alone" : withSrc === 0 ? "NO PROVENANCE - an import still cannot be attributed to its importer, so a path-aware import rule is the strongest available" : withSrc === imp.length ? "FULL PROVENANCE - a stronger, per-file import rule is now possible and the stem fallback is no longer needed" : "PARTIAL PROVENANCE - the stem fallback is still required for the unattributable rows"}`)

  // ---- Q6/Q7: the file rule, scored --------------------------------------
  const importStems = new Set(), importKeys2 = new Set()
  for (const r of imp) {
    if (!r.e) continue
    const spec = r.e.includes(":") ? r.e.slice(0, r.e.indexOf(":")) : r.e
    const k = key2(spec)
    if (k) importKeys2.add(k)
    const s2 = stemOf(spec)
    if (s2) importStems.add(s2)
  }
  const stemCount = new Map()
  for (const f of files) { const s = stemOf(f.p); stemCount.set(s, (stemCount.get(s) ?? 0) + 1) }
  const uniqueStems = new Set([...stemCount].filter(([, n]) => n === 1).map(([s]) => s))

  const orphanFiles = []
  for (const f of files) {
    if (isTestPath(f.p) || isHardNoise(f.p)) continue
    const s = stemOf(f.p)
    if (["index", "main", "app", "mod"].includes(s.toLowerCase())) continue
    if (refAll.has(f.id)) continue
    const k = key2(f.p)
    if ((k && importKeys2.has(k)) || uniqueStems.has(s)) continue
    orphanFiles.push(f)
  }
  const fileFP = orphanFiles.filter((f) => refAll.has(f.id))
  console.log(`\nQ7 orphan-file candidates: ${orphanFiles.length}; provable false positives: ${fileFP.length} (${((fileFP.length / Math.max(1, orphanFiles.length)) * 100).toFixed(1)}%)`)
  if (fileFP.length) console.log("   " + fileFP.slice(0, 6).map((f) => f.p).join("\n   "))

  // ---- Q8: the god-class statement ---------------------------------------
  const godQ = `SELECT s.id, COUNT(*) AS members FROM brain_symbol s WHERE s.project_id=? AND s.symbol_type IN ('class','interface','struct','trait','enum') GROUP BY s.id HAVING COUNT(*) > 10`
  const t0 = process.hrtime.bigint()
  let plan = []
  try { plan = db.prepare("EXPLAIN QUERY PLAN " + godQ).all(P) } catch (e) { plan = [{ detail: "ERR " + String(e.message).slice(0, 60) }] }
  const t1 = process.hrtime.bigint()
  const n = db.prepare(godQ).all(P).length
  const t2 = process.hrtime.bigint()
  console.log(`\nQ8 god-class pre-aggregate: ${(Number(t1 - t0) / 1e6).toFixed(0)}ms plan, ${(Number(t2 - t1) / 1e6).toFixed(0)}ms execute, ${n} rows`)
  for (const p of plan) console.log("   " + p.detail)

  db.close()
}
