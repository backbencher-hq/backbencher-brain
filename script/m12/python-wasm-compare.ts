// M12.27 Python: compare pinned tree-sitter-python wasm vs npm
// tree-sitter-python 0.25.0 wasm on the corpus — CORRECTED methodology.
//
// The old in-process swap was silently invalid: _autoLoadWasm caches every
// wasm from the repo wasm/ dir into the registry at module init, and getParser
// reads hasWasmInRegistry (cached bytes). Swapping the file mid-process never
// affected the second scan — both scans read the identical pinned bytes, so
// "0 fixed / 0 regressed" was guaranteed, not evidence of equivalence.
//
// Correct approach: fork a FRESH subprocess per scan. Each process re-imports
// the wasm module and re-reads the file from disk at init. We swap the pinned
// wasm file between the two subprocess invocations, so each scan genuinely
// exercises its own grammar through the production parseFile path.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from "node:fs"

const ROOT = "$HOME/mcp/backbencher-brain"
const PINNED = `${ROOT}/wasm/tree-sitter-python.wasm`
const NEW = "/tmp/ts-python-npm/node_modules/tree-sitter-python/tree-sitter-python.wasm"
const SCAN = `${ROOT}/script/m12/python-wasm-scan.ts`
const BACKUP = "/tmp/ts-python-pinned-backup.wasm"

function scan(): { scanned: number; errors: number; files: string[] } {
  const out = execFileSync("bun", ["run", SCAN], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600_000,
  })
  return JSON.parse(out.trim().split("\n").pop() || "{}")
}

function main() {
  if (!existsSync(NEW)) throw new Error("npm wasm missing")
  copyFileSync(PINNED, BACKUP)
  try {
    const pinned = scan()
    console.log(`pinned: ${pinned.errors}/${pinned.scanned} error files`)
    const pinnedSet = new Set(pinned.files)

    const npmWasm = readFileSync(NEW)
    writeFileSync(PINNED, npmWasm)
    const npm = scan()
    console.log(`npm:    ${npm.errors}/${npm.scanned} error files`)
    const npmSet = new Set(npm.files)

    const fixed = pinned.files.filter((f) => !npmSet.has(f))
    const regressed = npm.files.filter((f) => !pinnedSet.has(f))
    const both = pinned.files.filter((f) => npmSet.has(f))
    console.log(`fixed by npm: ${fixed.length}  regressed: ${regressed.length}  both error: ${both.length}`)
    for (const f of fixed.slice(0, 15)) console.log(`  FIXED ${f}`)
    for (const f of regressed.slice(0, 15)) console.log(`  REGRESS ${f}`)
  } finally {
    copyFileSync(BACKUP, PINNED)
    rmSync(BACKUP)
  }
}

main()
