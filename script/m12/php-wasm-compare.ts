// M12.29 PHP: compare pinned tree-sitter-php vs npm tree-sitter-php 0.24.2.
//
// Corrected methodology (from the Python M12.27 finding): an in-process file
// swap is silently invalid because _autoLoadWasm caches registry bytes at
// module init. Each scan runs in a FRESH subprocess so it re-reads the wasm
// file from disk at init; we swap the pinned wasm between the two runs.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from "node:fs"

const ROOT = "$HOME/mcp/backbencher-brain"
const PINNED = `${ROOT}/wasm/tree-sitter-php.wasm`
const NEW = "/tmp/ts-php-npm/package/tree-sitter-php.wasm"
const SCAN = `${ROOT}/script/m12/php-wasm-scan.ts`
const BACKUP = "/tmp/ts-php-pinned-backup.wasm"

function scan(): { scanned: number; errors: number; files: string[] } {
  const out = execFileSync("bun", ["run", SCAN], { cwd: ROOT, encoding: "utf8", timeout: 600_000 })
  return JSON.parse(out.trim().split("\n").pop() || "{}")
}

function main() {
  if (!existsSync(NEW)) throw new Error("npm wasm missing")
  copyFileSync(PINNED, BACKUP)
  try {
    const pinned = scan()
    console.log(`pinned: ${pinned.errors}/${pinned.scanned} error files`)
    const pinnedSet = new Set(pinned.files)

    writeFileSync(PINNED, readFileSync(NEW))
    const npm = scan()
    console.log(`npm:    ${npm.errors}/${npm.scanned} error files`)
    const npmSet = new Set(npm.files)

    const fixed = pinned.files.filter((f) => !npmSet.has(f))
    const regressed = npm.files.filter((f) => !pinnedSet.has(f))
    console.log(`fixed by npm: ${fixed.length}  regressed: ${regressed.length}`)
    for (const f of fixed.slice(0, 30)) console.log(`  FIXED ${f}`)
    for (const f of regressed.slice(0, 30)) console.log(`  REGRESS ${f}`)
  } finally {
    copyFileSync(BACKUP, PINNED)
    rmSync(BACKUP)
  }
}

main()
