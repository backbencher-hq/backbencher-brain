#!/usr/bin/env npx tsx
/**
 * probe-store-phases.ts — what does the store phase actually spend its time on?
 *
 * The audit's reading of the code said the per-edge target-resolution SELECT ("C did not
 * disappear, it moved into the store") dominated `dbFlushMs`. That is a claim about where
 * time goes, so it gets an experiment rather than an argument: this probe runs the same
 * corpus twice — once normally, once with the per-edge resolve switched off
 * (BB_TEST_SKIP_EDGE_RESOLVE=1) — and reports the store phase for both.
 *
 * Usage: npx tsx script/perf/probe-store-phases.ts <poolDir> [repeats]
 *
 * Result on n200 (196 files, 62,085 relationships, this machine, 2026-10-09):
 *
 *   with the resolve      dbFlushMs 31,894 · 28,291   (two runs)
 *   without it            dbFlushMs (see the run — the point is the DIFFERENCE)
 *
 * The graph is NOT correct in the skip mode (target_symbol_id stays NULL); it exists to
 * attribute the time, nothing else.
 */
import { spawnSync } from "node:child_process"
import { rmSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import Database from "better-sqlite3"

const REPO = process.cwd()
const dir = process.argv[2]
const repeats = Number(process.argv[3] ?? 1)
if (!dir) {
  console.error("usage: probe-store-phases.ts <poolDir> [repeats]")
  process.exit(2)
}

const run = (label: string, env: Record<string, string>) => {
  const dataDir = path.join(REPO, `.store-phase-${label}`)
  rmSync(dataDir, { recursive: true, force: true })
  const out = spawnSync("npx", ["tsx", "script/perf/profile-stages.ts", dir, label], {
    cwd: REPO,
    env: { ...process.env, BB_DATA_DIR: dataDir, ...env },
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
  const line = (out.stdout ?? "").split("\n").reverse().find((l) => l.startsWith("{"))
  if (!line) {
    console.error(`${label}: no result line`)
    console.error((out.stderr ?? "").split("\n").slice(-4).join("\n"))
    return null
  }
  const j = JSON.parse(line)
  // The resolution fingerprint: a hash over (relationship id -> resolved target id).
  // `relHash` is name-based and CANNOT see resolution changes, so an equivalence claim
  // about the resolve needs this one. Read before deleting the data dir.
  let resolutionHash = "n/a"
  let nullTargets = -1
  try {
    const projectsRoot = path.join(dataDir, "projects")
    const projectDir = path.join(projectsRoot, readdirSync(projectsRoot)[0]!)
    const db = new Database(path.join(projectDir, "brain.db"), { readonly: true })
    const rows = db.prepare("SELECT id, target_symbol_id FROM brain_relationship ORDER BY id").all() as Array<{ id: string; target_symbol_id: string | null }>
    nullTargets = rows.filter((r) => r.target_symbol_id === null).length
    const h = createHash("sha256")
    for (const r of rows) h.update(`${r.id}\u0000${r.target_symbol_id ?? ""}\n`)
    resolutionHash = h.digest("hex").slice(0, 16)
    db.close()
  } catch (e: any) {
    resolutionHash = `err:${String(e?.message).slice(0, 40)}`
  }
  rmSync(dataDir, { recursive: true, force: true })
  return { label, dbFlushMs: j.phases.dbFlushMs, parseMs: j.phases.parseMs, wallMs: j.wallMs, rels: j.relationships, relHash: j.relHash, resolutionHash, nullTargets }
}

const results: any[] = []
for (let i = 0; i < repeats; i++) {
  results.push(run("resolve", {}))
  results.push(run("skipresolve", { BB_TEST_SKIP_EDGE_RESOLVE: "1" }))
}
console.log("\n=== store phase, with and without the per-edge resolve ===")
for (const r of results) {
  if (!r) continue
  console.log(
    `  ${r.label.padEnd(12)} dbFlushMs ${String(r.dbFlushMs).padStart(6)}  parseMs ${String(r.parseMs).padStart(6)}  wall ${String(r.wallMs).padStart(6)}  rels ${r.rels}  nullTargets ${String(r.nullTargets).padStart(6)}  resolution ${r.resolutionHash}`,
  )
}
const withResolve = results.filter((r) => r && r.label === "resolve").map((r) => r.dbFlushMs)
const without = results.filter((r) => r && r.label === "skipresolve").map((r) => r.dbFlushMs)
if (withResolve.length && without.length) {
  const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length)
  const w = avg(withResolve)
  const o = avg(without)
  console.log(
    `\n  mean dbFlushMs: ${w} with the resolve, ${o} without — difference ${w - o} ms ` +
      `(${(((w - o) / w) * 100).toFixed(1)}% of the store phase)`,
  )
}
