// M12.22 Go: corpus error scan on the pinned go-tools revision
// (bf54bcd2f14a330f0dcffa4cf631235de771bde2). Uses the production
// parseFile pipeline (pool-worker) on a deterministic sample of Go files
// >= 1KB, mirroring the C/Rust/Zig/Swift precedent.
import { readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS = "$HOME/fixtures/repositories/go-tools"

function collectGoFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectGoFiles(full, out)
    else if (entry.name.endsWith(".go")) out.push(full)
  }
  return out
}

async function main() {
  const all = collectGoFiles(CORPUS)
    .filter((f) => statSync(f).size >= 1024)
    .sort()
  const sample = all.slice(0, 400)
  let errors = 0
  let crashes = 0
  let timeouts = 0
  const errorFiles: string[] = []
  for (const f of sample) {
    try {
      const p = await parseFile(resolve(f), CORPUS)
      if (p.errors && p.errors.length > 0) {
        errors++
        errorFiles.push(`${f.replace(CORPUS + "/", "")} (${p.errors.length} errors)`)
      }
    } catch (e: any) {
      crashes++
      console.log(`CRASH ${f}: ${e?.message?.slice(0, 120)}`)
    }
  }
  console.log(`sample=${sample.length} errors=${errors} crashes=${crashes} timeouts=${timeouts}`)
  console.log(`rate=${(errors / sample.length * 100).toFixed(2)}%`)
  if (errorFiles.length > 0) {
    console.log("--- error files ---")
    for (const ef of errorFiles.slice(0, 30)) console.log(ef)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
