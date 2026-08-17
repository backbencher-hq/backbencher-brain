// M12.24 Erlang: corpus error scan — parse the deterministic first-N ≥1KB .erl
// files through the PRODUCTION path (pool-worker parseFile → ASTEngine) and
// report parse errors, crashes, and timeouts.
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT_REPO = "$HOME/fixtures/repositories/rebar3"
const SAMPLE = 225

function collect(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "_build") continue
        walk(p)
      } else if (e.name.endsWith(".erl") && statSync(p).size >= 1024) {
        out.push(p)
      }
    }
  }
  walk(root)
  return out.sort()
}

async function main() {
  const all = collect(ROOT_REPO)
  const sample = all.slice(0, SAMPLE)
  let errors = 0, crashes = 0, timeouts = 0
  const errFiles: string[] = []
  const started = Date.now()
  for (const f of sample) {
    try {
      const p = await parseFile(f, ROOT_REPO)
      if ((p.errors?.length ?? 0) > 0) {
        errors++
        errFiles.push(`${f.replace(ROOT_REPO + "/", "")} (${p.errors.length})`)
      }
    } catch (e: any) {
      crashes++
      console.error(`CRASH ${f}: ${e?.message?.slice(0, 120)}`)
    }
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`sample=${sample.length} total>=1KB=${all.length} errors=${errors} crashes=${crashes} timeouts=${timeouts} in ${elapsed}s`)
  for (const f of errFiles.slice(0, 30)) console.log(`  ERR ${f}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
