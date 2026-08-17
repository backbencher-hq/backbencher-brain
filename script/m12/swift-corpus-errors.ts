// M12.21 Swift: corpus error scan on swift-nio (deterministic first-400
// sorted slice of tracked *.swift files >= 1KB — the Rust/Zig precedent).
import { execSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const REPO = "$HOME/fixtures/repositories/swift-nio"

async function main() {
  // Tracked files (git ls-files), like the M11 corpus gate.
  const tracked: string[] = execSync(`cd ${REPO} && git ls-files '*.swift'`, { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()

  const big = tracked.filter((f) => {
    try {
      return statSync(join(REPO, f)).size >= 1024
    } catch {
      return false
    }
  })

  const sample = big.slice(0, 400)
  console.log(`tracked=${tracked.length} >=1KB=${big.length} sample=${sample.length}`)

  let errs = 0
  let crashes = 0
  let timeouts = 0
  const errFiles: string[] = []
  for (let i = 0; i < sample.length; i++) {
    const f = sample[i]
    try {
      const p = await parseFile(join(REPO, f), process.cwd())
      const fileErrors = (p as any).errors?.length ?? 0
      if (fileErrors > 0) {
        errs++
        errFiles.push(`${f} (${fileErrors})`)
      }
    } catch (e: any) {
      crashes++
      console.error(`CRASH ${f}: ${e?.message?.slice(0, 120)}`)
    }
  }
  console.log(`errors=${errs} crashes=${crashes} timeouts=${timeouts}`)
  console.log("--- error files (first 30) ---")
  for (const f of errFiles.slice(0, 30)) console.log(f)
  console.log(`--- total err files: ${errFiles.length} ---`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
