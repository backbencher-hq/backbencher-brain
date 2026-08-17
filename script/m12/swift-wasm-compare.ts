// M12.21 Swift: compare pinned grammar vs npm 0.7.1 via the production
// parseFile path (engine error walk includes anonymous MISSING tokens).
import { execSync } from "node:child_process"
import { statSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const REPO = "$HOME/fixtures/repositories/swift-nio"
const ROOT = process.cwd()
const NEW_WASM = "/tmp/tree-sitter-swift-new.wasm"

async function scan(sample: string[]): Promise<{ errFiles: Set<string>; counts: Map<string, number> }> {
  const errFiles = new Set<string>()
  const counts = new Map<string, number>()
  for (const f of sample) {
    const p = await parseFile(join(REPO, f), ROOT)
    const errs = (p as any).errors?.length ?? 0
    if (errs > 0) {
      errFiles.add(f)
      counts.set(f, errs)
    }
  }
  return { errFiles, counts }
}

async function main() {
  const tracked: string[] = execSync(`cd ${REPO} && git ls-files '*.swift'`, { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
  const big = tracked.filter((f) => {
    try { return statSync(join(REPO, f)).size >= 1024 } catch { return false }
  })
  const sample = big.slice(0, 400)

  console.log("scanning with pinned grammar...")
  const pinned = await scan(sample)

  const cachePath = "/tmp/bb-wasm_tree-sitter-swift_tree-sitter-swift.wasm"
  const backup = `${cachePath}.pinned`
  execSync(`cp ${cachePath} ${backup}`)
  execSync(`cp ${NEW_WASM} ${cachePath}`)

  try {
    console.log("scanning with npm 0.7.1 grammar...")
    const fresh = await scan(sample)
    const fixed = [...fresh.errFiles].filter((f) => !pinned.errFiles.has(f))
    const regressed = [...pinned.errFiles].filter((f) => !fresh.errFiles.has(f))
    console.log(`pinned: ${pinned.errFiles.size}/${sample.length}  npm0.7.1: ${fresh.errFiles.size}/${sample.length}`)
    console.log(`fixed by upgrade: ${regressed.length}  regressed: ${fixed.length}`)
    for (const f of regressed.slice(0, 15)) console.log(`  FIXED ${f} (${pinned.counts.get(f)} -> 0)`)
    for (const f of fixed.slice(0, 15)) console.log(`  REGRESSED ${f}`)
  } finally {
    execSync(`cp ${backup} ${cachePath}`)
    execSync(`rm -f ${backup}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
