#!/usr/bin/env npx tsx
/**
 * verify-resolution-determinism.ts — does the same input produce the same graph?
 *
 * Why this exists
 * ---------------
 * Three runs of identical code on the same corpus produced three different resolution
 * fingerprints (validation/m60/results/store-phase-resolution.md §3): the product binds
 * ~0.6% of edges differently every time. `relHash` cannot see it — it hashes relationship
 * NAMES, so every one of those runs would pass a relHash equivalence check — which is why
 * two attempts to remove the eager per-edge resolve could not be certified either way, and
 * why any future graph change is currently unverifiable.
 *
 * This gate makes that measurable. It indexes the same corpus into two fresh data
 * directories and compares:
 *
 *   relHash        the relationship multiset by name (expected: identical)
 *   resolution     a hash over (relationship id -> resolved target id)  <- the real check
 *   nullTargets    rows with no attached target
 *
 * Exit policy, following the W1 gate's convention: a KNOWN GAP does not fail the chain, it
 * is REPORTED and named. `--strict` exits non-zero, which is the mode to wire into
 * `npm run verify` once resolution is deterministic — at which point this gate flips from
 * "here is the drift" to "the drift is back".
 *
 * Usage: npx tsx script/perf/verify-resolution-determinism.ts <poolDir> [--strict] [--keep]
 */
import { spawnSync } from "node:child_process"
import { rmSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import Database from "better-sqlite3"

const REPO = process.cwd()
const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith("--"))
const strict = args.includes("--strict")
const keep = args.includes("--keep")
if (!dir) {
  console.error("usage: verify-resolution-determinism.ts <poolDir> [--strict] [--keep]")
  process.exit(2)
}

interface Fingerprint {
  relHash: string
  resolutionHash: string
  nullTargets: number
  relationships: number
  resolution: Map<string, string | null>
}

function indexOnce(label: string): Fingerprint | null {
  const dataDir = path.join(REPO, `.determinism-${label}`)
  rmSync(dataDir, { recursive: true, force: true })
  const out = spawnSync("npx", ["tsx", "script/perf/profile-stages.ts", dir!, label], {
    cwd: REPO,
    env: { ...process.env, BB_DATA_DIR: dataDir },
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
  const projectsRoot = path.join(dataDir, "projects")
  const projectDir = path.join(projectsRoot, readdirSync(projectsRoot)[0]!)
  const db = new Database(path.join(projectDir, "brain.db"), { readonly: true })
  const rows = db.prepare("SELECT id, target_symbol_id FROM brain_relationship ORDER BY id").all() as Array<{
    id: string
    target_symbol_id: string | null
  }>
  db.close()
  const h = createHash("sha256")
  for (const r of rows) h.update(`${r.id}\u0000${r.target_symbol_id ?? ""}\n`)
  const fp: Fingerprint = {
    relHash: j.relHash,
    resolutionHash: h.digest("hex").slice(0, 16),
    nullTargets: rows.filter((r) => r.target_symbol_id === null).length,
    relationships: rows.length,
    resolution: new Map(rows.map((r) => [r.id, r.target_symbol_id])),
  }
  if (!keep) rmSync(dataDir, { recursive: true, force: true })
  return fp
}

const a = indexOnce("a")
const b = indexOnce("b")
if (!a || !b) process.exit(1)

let differing = 0
const examples: string[] = []
for (const [id, target] of a.resolution) {
  const other = b.resolution.get(id)
  if (other !== target) {
    differing++
    if (examples.length < 5) examples.push(`${id}: ${target ?? "(none)"} vs ${other ?? "(none)"}`)
  }
}

console.log(`\nRESOLUTION DETERMINISM — the same corpus, indexed twice, same code\n`)
console.log(`  relationships        : ${a.relationships} (both runs)`)
console.log(`  relHash              : ${a.relHash} / ${b.relHash}  ${a.relHash === b.relHash ? "(identical)" : "(DIFFERENT)"}`)
console.log(`  resolution fingerprint: ${a.resolutionHash} / ${b.resolutionHash}`)
console.log(`  attached targets     : ${a.relationships - a.nullTargets} / ${b.relationships - b.nullTargets}`)
console.log(`  bindings that differ : ${differing}${differing ? ` of ${a.relationships} (${((differing / a.relationships) * 100).toFixed(2)}%)` : ""}`)
for (const e of examples) console.log(`      ${e}`)

if (differing === 0) {
  console.log(`\nRESOLUTION DETERMINISM: PASS — identical inputs produced identical bindings\n`)
  process.exit(0)
}

console.log(
  `\nRESOLUTION DETERMINISM: KNOWN GAP — identical inputs bind ${differing} edge(s) differently.\n` +
    `  The graph is not reproducible run to run, which is why a change to the resolution path\n` +
    `  cannot be certified by comparing two runs. Name-based relHash agrees in both runs, so it\n` +
    `  cannot detect this. See validation/m60/results/store-phase-resolution.md.\n`,
)
process.exit(strict ? 1 : 0)
