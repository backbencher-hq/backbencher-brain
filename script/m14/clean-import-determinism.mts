#!/usr/bin/env tsx
/**
 * CLEAN lane — is the imports non-determinism a RACE (a second pass fixes it) or INHERENT?
 *
 * `clean-unattached-variance.mts` measured that over the same 120-file slice the edge
 * count, the symbol count, `brain_file`, and `brain_import` are bit-stable across runs, and
 * that the entire unattached spread is the `imports` type (311 / 347 / 448 / 255 / 284 /
 * 305 / 272 observed). Every other type is bit-identical.
 *
 * Two explanations, and they need different remedies:
 *
 *   RACE     something is not yet visible when the resolver reads, and a SECOND pass over
 *            the same, now-complete database resolves the rest. If so, calling
 *            runPostProcessing twice drives unattached to a fixed point.
 *   INHERENT the resolver's decision genuinely depends on row order within one pass, so a
 *            second pass resolves nothing more and the number is a coin-flip per index.
 *
 * One measurement separates them: index once, record unattached, run post-processing
 * again on the SAME database, record again. Convergence to a fixed value is a race and
 * the fix is to call the pass twice; no movement is inherent and the fix is to make the
 * resolver order-independent.
 *
 * ## Usage
 *
 *   npx tsx script/m14/clean-import-determinism.mts --files=120 --runs=3
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const RUNS = Number(arg("runs") ?? "3")
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
  const src = path.join(os.tmpdir(), `bb-clean-det-src-${process.pid}`)
  fs.mkdirSync(src, { recursive: true })
  for (const f of taken) {
    const dest = path.join(src, path.relative(CORPUS, f))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, fs.readFileSync(f))
  }

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, runPostProcessing } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const q = (raw: any, pid: any, sql: string) => (raw.prepare(sql).get(pid) as any).n
  const IMPORTS = `SELECT COUNT(*) AS n FROM brain_relationship
     WHERE project_id = ? AND target_external IS NOT NULL AND target_symbol_id IS NULL
       AND relationship_type = 'imports'`
  const TOTAL = `SELECT COUNT(*) AS n FROM brain_relationship
     WHERE project_id = ? AND target_external IS NOT NULL AND target_symbol_id IS NULL`

  console.log(`index once, then run post-processing three more times on the SAME database`)
  console.log(`per run: unattached imports and unattached total after each additional pass\n`)

  const series: number[][] = []
  for (let r = 0; r < RUNS; r++) {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `bb-clean-det-${r}-`))
    const dataDir = path.join(workdir, "data")
    fs.mkdirSync(dataDir, { recursive: true })
    process.env.BB_DATA_DIR = dataDir
    const pid = getProjectId(src) as any
    await indexProjectParallel(pid, src, { onProgress: () => {} })

    const row: number[] = []
    for (let pass = 0; pass < 3; pass++) {
      if (pass > 0) await runPostProcessing(pid, { lockHeld: true })
      const raw: any = await BrainDatabase.getRawInstance(pid)
      row.push(q(raw, pid, IMPORTS))
      void TOTAL
    }
    const raw: any = await BrainDatabase.getRawInstance(pid)
    const tot = q(raw, pid, TOTAL)
    series.push(row)
    console.log(`run ${r + 1}: imports unattached after pass 0/1/2 = ${row.join(" -> ")}   (total unattached after final pass: ${tot})`)
    fs.rmSync(workdir, { recursive: true, force: true })
  }
  fs.rmSync(src, { recursive: true, force: true })

  console.log(`\nper-pass values across runs:`)
  for (let pass = 0; pass < 3; pass++) {
    const vs = series.map((s) => s[pass])
    const lo = Math.min(...vs), hi = Math.max(...vs)
    console.log(`  after pass ${pass}: ${JSON.stringify(vs)}   spread ${hi - lo}${hi - lo ? "   <-- still varying" : "   converged"}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })