// M12.27 Python: standalone corpus error scan — one FRESH process per scan.
// A fresh process re-imports the wasm module, so _autoLoadWasm re-reads the
// wasm file from disk at process start. The orchestrator (python-wasm-compare.ts)
// swaps the pinned wasm file between two invocations of this script, making the
// comparison genuinely exercise both grammars through the production parseFile
// path (unlike the old in-process swap, which read the module-init registry
// cache for both scans).
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS = "$HOME/fixtures/repositories/cython"

const sample = (() => {
  const { execSync } = require("child_process")
  return execSync(`cd ${CORPUS} && git ls-files '*.py'`, { encoding: "utf8" })
    .split("\n").map((s: string) => s.trim()).filter(Boolean).sort()
    .filter((f: string) => {
      const { statSync } = require("node:fs")
      try { return statSync(`${CORPUS}/${f}`).size >= 1024 } catch { return false }
    })
})()

async function main() {
  let errors = 0
  const files: string[] = []
  for (const f of sample) {
    try {
      const p = await parseFile(`${CORPUS}/${f}`, CORPUS)
      if ((p.errors?.length ?? 0) > 0) {
        errors++
        files.push(f)
      }
    } catch {}
  }
  console.log(JSON.stringify({ scanned: sample.length, errors, files }))
}

main().catch((e) => { console.error(e); process.exit(1) })
