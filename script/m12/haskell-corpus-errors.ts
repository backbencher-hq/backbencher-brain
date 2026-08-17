// M12.25: Haskell corpus error scan through the production pipeline.
// Parses every tracked *.hs file >= 1KB from cabal@670955a4 (deterministic
// sorted order, matching the M11 corpus methodology) with a FRESH parser per
// file (the production parseFile path) and reports grammar-error files,
// crashes, and timeouts.
import { execSync } from "node:child_process"
import { statSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const REPO = "$HOME/fixtures/repositories/cabal"
const ROOT = process.cwd()

// Deterministic: all tracked *.hs files >= 1KB, sorted lexicographically.
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

let errorFiles = 0
let crashFiles = 0
let totalErrors = 0
const details: { file: string; errors: number; firstNode: string }[] = []

for (let i = 0; i < tracked.length; i++) {
  const f = tracked[i]
  const abs = join(REPO, f)
  try {
    const p = await parseFile(abs, ROOT)
    const errs = p.errors?.length ?? 0
    if (errs > 0) {
      errorFiles++
      totalErrors += errs
      details.push({ file: f, errors: errs, firstNode: p.errors?.[0]?.message?.slice(0, 80) ?? "" })
    }
  } catch (e: any) {
    crashFiles++
    console.log(`CRASH: ${f}: ${e?.message?.slice(0, 120)}`)
  }
  if ((i + 1) % 100 === 0) console.log(`progress: ${i + 1}/${tracked.length}`)
}

console.log(`\n=== haskell corpus ===`)
console.log(`files>=1KB: ${tracked.length}`)
console.log(`errorFiles: ${errorFiles} (${((errorFiles / tracked.length) * 100).toFixed(2)}%)`)
console.log(`crashFiles: ${crashFiles}`)
console.log(`totalErrorNodes: ${totalErrors}`)
for (const d of details.slice(0, 20)) console.log(`  ${d.file}: ${d.errors} errors (${d.firstNode})`)
