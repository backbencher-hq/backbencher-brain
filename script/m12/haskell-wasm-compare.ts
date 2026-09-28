// M12.25: compare npm tree-sitter-haskell 0.23.1 wasm against the pinned
// grammar on the corpus via the production parseFile path (the Swift/Go/Erlang
// precedent). Reports error files for each and the delta.
import { execSync } from "node:child_process"
import { copyFileSync, mkdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const REPO = "$HOME/fixtures/repositories/cabal"
const ROOT = process.cwd()
const NPM_WASM = "/tmp/ts-haskell-npm/node_modules/tree-sitter-haskell/tree-sitter-haskell.wasm"
const PINNED_WASM = join(ROOT, "wasm/tree-sitter-haskell.wasm")

const tracked: string[] = execSync(`git -C ${REPO} ls-files '*.hs'`, { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.trim().length > 0)
  .sort()
  .filter((f) => {
    try {
      return statSync(join(REPO, f)).size >= 1024
    } catch {
      return false
    }
  })

// Fresh parser per file, exactly the production path. parseFile loads the wasm
// via resolveWasm(); we temporarily swap the pinned wasm to compare behavior.
async function scan(wasmPath: string): Promise<{ errFiles: string[]; totalErrors: number }> {
  // Backup pinned, swap in the candidate
  const backup = "/tmp/hs-pinned-backup.wasm"
  if (!existsSync(backup)) copyFileSync(PINNED_WASM, backup)
  copyFileSync(wasmPath, PINNED_WASM)
  const errFiles: string[] = []
  let totalErrors = 0
  for (let i = 0; i < tracked.length; i++) {
    const p = await parseFile(join(REPO, tracked[i]), ROOT)
    const errs = p.errors?.length ?? 0
    if (errs > 0) {
      errFiles.push(tracked[i])
      totalErrors += errs
    }
  }
  return { errFiles, totalErrors }
}

try {
  const pinned = await scan(PINNED_WASM)
  const npm = await scan(NPM_WASM)
  // Restore pinned
  copyFileSync("/tmp/hs-pinned-backup.wasm", PINNED_WASM)

  const pinnedSet = new Set(pinned.errFiles)
  const npmSet = new Set(npm.errFiles)
  const fixed = [...pinnedSet].filter((f) => !npmSet.has(f))
  const regressed = [...npmSet].filter((f) => !pinnedSet.has(f))
  console.log(`pinned: ${pinned.errFiles.length} error files, ${pinned.totalErrors} error nodes`)
  console.log(`npm 0.23.1: ${npm.errFiles.length} error files, ${npm.totalErrors} error nodes`)
  console.log(`fixed by npm: ${fixed.length} (${fixed.slice(0, 5).join(", ")})`)
  console.log(`regressed by npm: ${regressed.length} (${regressed.slice(0, 5).join(", ")})`)
  console.log(fixed.length === 0 && regressed.length === 0 ? "BEHAVIORALLY IDENTICAL — no upgrade warranted" : "DIFFERENT — inspect")
} finally {
  if (existsSync("/tmp/hs-pinned-backup.wasm")) copyFileSync("/tmp/hs-pinned-backup.wasm", PINNED_WASM)
}
