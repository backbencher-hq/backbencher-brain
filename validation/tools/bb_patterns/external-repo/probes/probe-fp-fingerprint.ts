// bb_tests/bb_patterns/probes/probe-fp-fingerprint.ts
// A behavioural fingerprint of detectOrphans, taken before and after a change.
//
// L4 showed the single relationship pass costs 187s on `move` and that ~49s of
// that is better-sqlite3 shipping 710,671 rows into JS to build sets that are
// bounded by the SYMBOL count, not the relationship count. The obvious fix is to
// push the reductions into SQL, which is only safe if the output is provably
// identical.
//
// "Identical" cannot mean the headline count: a count matching while different
// symbols are reported is the failure mode this lane has hit repeatedly (a
// verifier that counted its own regex literals; a harness comparing TARGETS ONLY
// so a mutant that mislabelled every construction came back CLEAN). So the
// fingerprint is a hash over the whole answer — every finding's file, symbol,
// line, rule, confidence, and its evidence and limitations text — plus every
// counter in the summary. Two runs that agree on the hash agree on everything a
// caller can observe.
//
// Usage:  probe-fp-fingerprint.ts <out.json> [<out2.json> ...]
//         With two or more outputs it prints which corpora differ.

import path from "node:path"
import { createRequire } from "node:module"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const { detectOrphans } = await import(path.join(REPO, "src/intelligence/patterns/orphans.ts"))

const outPaths = process.argv.slice(2)
if (outPaths.length === 0) {
  console.error("usage: probe-fp-fingerprint.ts <out.json> [...]")
  process.exit(2)
}

// Every complete project in the one data directory the engine will use. Reading
// the pid list from the same directory BB_DATA_DIR names is the whole point of
// probe-l1's guard: the engine resolves its own database from there, and a probe
// that looks elsewhere measures an empty one.
const { readdirSync } = await import("node:fs")
const dir = path.join(process.env.BB_DATA_DIR, "projects")
const pids = readdirSync(dir).filter((p) => {
  const dbPath = path.join(dir, p, "brain.db")
  try {
    const d = new Database(dbPath, { readonly: true, fileMustExist: true })
    const n = d.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(p) as { c: number }
    const s = d.prepare("SELECT status FROM brain_index_status WHERE project_id = ?").get(p) as { status: string } | undefined
    d.close()
    return n.c > 0 && s?.status === "complete"
  } catch {
    return false
  }
})
// If the filter above ever comes back empty, that is a HARNESS failure and not a
// result — a run that fingerprints nothing looks identical to "nothing changed".
// An earlier draft of this file lost `dbPath` in an edit, every filter callback
// threw, every project was skipped, and the probe reported `{}` and exited 0.
if (pids.length === 0) {
  console.error(`no complete project found under ${dir} — refusing to fingerprint nothing`)
  process.exit(2)
}

const fingerprints: Record<string, unknown> = {}
const full = new Map<string, string[]>()
for (const pid of pids.sort()) {
  const report = await detectOrphans(pid, { minConfidence: 0, maxResults: 1_000_000 })
  // Canonical serialisation: sorted, so two runs that differ only in the order
  // SQLite happened to return rows still agree.
  const findings = report.findings
    .map((f) => [
      f.rule, f.location.file, f.location.symbol ?? "", f.location.line ?? -1,
      f.confidence.toFixed(6), f.severity, f.description,
      f.evidence.map((e) => `${e.type}:${e.description}`).join("|"),
      f.limitations.join("|"),
      f.remediation,
    ].join("\x1f"))
    .sort()
  const summary = report.summary as any
  // The refusal counters are counts, not identities; a change in WHICH rows were
  // refused with the same totals would pass, so the per-finding refused text
  // above is what carries identity. These numbers catch a change in totals.
  const summaryCanonical = JSON.stringify(
    Object.fromEntries(Object.entries(summary).sort(([a], [b]) => a.localeCompare(b))),
  )
  fingerprints[pid] = {
    count: findings.length,
    hash: createHash("sha256").update(findings.join("\x1e")).digest("hex").slice(0, 16),
    summary: createHash("sha256").update(summaryCanonical).digest("hex").slice(0, 16),
    unverified: summary?.unverifiedUsageEdges ?? null,
    suppressed: summary?.suppressedByReason ?? null,
    importResolution: summary?.importResolution ?? null,
  }
  full.set(pid, findings)
  const f = fingerprints[pid] as any
  console.log(`${pid.slice(0, 10)}  n=${String(f.count).padStart(6)}  findings=${f.hash}  summary=${f.summary}`)
}

const dumpDir = process.env.FP_DUMP_DIR
// Only the paths AFTER the first are written. The first is the BASELINE, taken
// before the change, and must be read and not overwritten.
//
// This version of the file wrote every path, so the baseline was overwritten with
// this run's own fingerprints and the comparison reported IDENTICAL on every
// corpus — a verdict that was true of nothing. It is the most expensive possible
// form of a vacuous test: it looked like proof that a rewrite was behaviour
// preserving, and proved nothing at all. The guard below refuses to run in that
// mode rather than letting it pass silently.
if (outPaths.length >= 2 && readFileSyncSafe(outPaths[0]) === null) {
  console.error(`no baseline at ${outPaths[0]} — take one with a single output path before comparing`)
  process.exit(2)
}
for (const p of outPaths.slice(outPaths.length >= 2 ? 1 : 0)) {
  writeFileSync(p, JSON.stringify(fingerprints, null, 2) + "\n")
}
function readFileSyncSafe(p: string): string | null {
  try { return readFileSync(p, "utf8") } catch { return null }
}
if (dumpDir) {
  for (const pid of Object.keys(fingerprints)) {
    writeFileSync(path.join(dumpDir, `${pid.slice(0, 10)}.txt`), (full.get(pid) ?? []).join("\n") + "\n")
  }
  console.log(`canonical per-finding text written to ${dumpDir}`)
}

// With two outputs, say exactly which corpora changed. A diff of two JSON blobs
// is unreadable at this size and invites a glance instead of a reading.
if (outPaths.length >= 2) {
  const [a, b] = outPaths
  let A: Record<string, any>
  try { A = JSON.parse(readFileSync(a, "utf8")) } catch { console.log(`no baseline at ${a}`); process.exit(1) }
  const B = JSON.parse(readFileSync(b, "utf8"))
  const diffs: string[] = []
  for (const pid of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[pid]
    const y = B[pid]
    if (!x) { diffs.push(`${pid.slice(0, 10)}: absent in baseline, present now`); continue }
    if (!y) { diffs.push(`${pid.slice(0, 10)}: present in baseline, absent now`); continue }
    if (x.hash !== y.hash) diffs.push(`${pid.slice(0, 10)}: FINDINGS differ (n ${x.count} -> ${y.count})`)
    else if (x.summary !== y.summary) diffs.push(`${pid.slice(0, 10)}: SUMMARY counters differ`)
    else if (x.unverified && JSON.stringify(x.unverified) !== JSON.stringify(y.unverified)) diffs.push(`${pid.slice(0, 10)}: unverifiedUsageEdges differ`)
    else if (x.suppressed && JSON.stringify(x.suppressed) !== JSON.stringify(y.suppressed)) diffs.push(`${pid.slice(0, 10)}: suppressedByReason differs`)
    else if (x.importResolution && JSON.stringify(x.importResolution) !== JSON.stringify(y.importResolution)) diffs.push(`${pid.slice(0, 10)}: importResolution differs`)
  }
  console.log(`\n${diffs.length === 0 ? "IDENTICAL" : `${diffs.length} DIFFERENCE(S):`}`)
  for (const d of diffs) console.log(`  ${d}`)
  process.exit(diffs.length === 0 ? 0 : 1)
}
