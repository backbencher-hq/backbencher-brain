#!/usr/bin/env tsx
/**
 * CLEAN lane — is the unattached count STABLE across runs?
 *
 * Four committed runs of the same instrument over the same 120-file slice produced
 * 1,681 / 1,780 / 1,625 / 1,767 unattached edges. The instrument is deterministic in its
 * input; if the number moves, something downstream of parseFile is not idempotent, and
 * every unattached figure this lane reports has that variance attached to it. Stating a
 * single one without the spread would be a claim the corpus does not support.
 *
 * This runs N independent full indexes of the same slice and prints the distribution, so
 * the spread is measured rather than remembered.
 *
 * ## Usage
 *
 *   npx tsx script/m14/clean-unattached-variance.mts --runs=4 --files=120
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const RUNS = Number(arg("runs") ?? "4")
const FILES = Number(arg("files") ?? "120")
const CORPUS = arg("corpus") ?? "$HOME/fixtures/repositories"

function admitted(): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(CORPUS)) {
    const dir = path.join(CORPUS, e)
    try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"],
        { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!/\.(icl|dcl)$/.test(rel)) continue
      const abs = path.join(dir, rel)
      try { if (fs.statSync(abs).size > 512 * 1024) continue } catch { continue }
      out.push(abs)
    }
  }
  return out.sort()
}

async function main() {
  const taken = admitted().slice(0, FILES)
  const src = path.join(os.tmpdir(), `bb-clean-var-src-${process.pid}`)
  fs.mkdirSync(src, { recursive: true })
  for (const f of taken) {
    const dest = path.join(src, path.relative(CORPUS, f))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, fs.readFileSync(f))
  }

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const runs: { edges: number; unattached: number; symbols: number; byType: Record<string, number> }[] = []
  console.log(`variance over ${RUNS} independent indexes of the same ${taken.length}-file slice\n`)
  for (let i = 0; i < RUNS; i++) {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `bb-clean-var-${i}-`))
    const dataDir = path.join(workdir, "data")
    fs.mkdirSync(dataDir, { recursive: true })
    process.env.BB_DATA_DIR = dataDir
    const pid = getProjectId(src) as any
    const st: any = await indexProjectParallel(pid, src, { onProgress: () => {} })
    const raw: any = await BrainDatabase.getRawInstance(pid)
    const e = (raw.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE project_id = ?").get(pid) as any).n
    const u = (raw.prepare(
      "SELECT COUNT(*) AS n FROM brain_relationship WHERE project_id = ? AND target_external IS NOT NULL AND target_symbol_id IS NULL",
    ).get(pid) as any).n
    const byType: Record<string, number> = {}
    for (const r of raw.prepare(
      "SELECT relationship_type AS t, COUNT(*) AS n FROM brain_relationship WHERE project_id = ? AND target_external IS NOT NULL AND target_symbol_id IS NULL GROUP BY t",
    ).all(pid) as any[]) byType[r.t] = r.n
    runs.push({ edges: e, unattached: u, symbols: st.symbolsExtracted, byType })
    console.log(`run ${i + 1}: edges ${String(e).padStart(6)}   unattached ${String(u).padStart(6)}   symbols ${st.symbolsExtracted}   indexer-reported unresolvedRelationships ${st.summary?.unresolvedRelationships}`)
    console.log(`         per type: ${JSON.stringify(byType)}`)
    fs.rmSync(workdir, { recursive: true, force: true })
  }
  fs.rmSync(src, { recursive: true, force: true })

  const us = runs.map((r) => r.unattached)
  const es = runs.map((r) => r.edges)
  const min = Math.min(...us), max = Math.max(...us)
  const mean = us.reduce((a, b) => a + b, 0) / us.length
  console.log(`\nunattached: min ${min}  max ${max}  mean ${mean.toFixed(1)}  spread ${max - min} (${((100 * (max - min)) / mean).toFixed(1)}% of mean)`)
  console.log(`edges:      min ${Math.min(...es)}  max ${Math.max(...es)}  spread ${Math.max(...es) - Math.min(...es)}`)

  // Which TYPE carries the spread. If one type moves and the rest are fixed, the cause is
  // local to that type's target spelling rather than a global race.
  const types = [...new Set(runs.flatMap((r) => Object.keys(r.byType)))].sort()
  console.log(`\nper-type unattached across ${RUNS} runs`)
  console.log(`type            ${runs.map((_, i) => `run${i + 1}`.padStart(8)).join("")}${"spread".padStart(9)}`)
  for (const t of types) {
    const vs = runs.map((r) => r.byType[t] ?? 0)
    const lo = Math.min(...vs), hi = Math.max(...vs)
    console.log(`${t.padEnd(14)}${vs.map((v) => String(v).padStart(8)).join("")}${String(hi - lo).padStart(9)}${hi - lo ? "   <-- MOVES" : ""}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })