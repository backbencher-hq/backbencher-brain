// M12.23 Elixir: compare pinned tree-sitter-elixir wasm vs npm 0.3.5 wasm on
// the corpus (elixir@024beb1b) — following the Swift/Go precedent: swap the
// cached wasm in place and scan through the PRODUCTION parseFile path.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = "$HOME/mcp/backbencher-brain"
const CORPUS = "$HOME/fixtures/repositories/elixir"
const PINNED = `${ROOT}/wasm/tree-sitter-elixir.wasm`
const NEW = "/tmp/ts-elixir-npm/package/tree-sitter-elixir.wasm"

const sample = (() => {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs")
  const { join } = require("node:path") as typeof import("node:path")
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue
        walk(p)
      } else if (e.name.endsWith(".ex") && statSync(p).size >= 1024) out.push(p)
    }
  }
  walk(CORPUS)
  return out.sort()
})()

async function scan(): Promise<{ errors: number; files: string[] }> {
  let errors = 0
  const files: string[] = []
  for (const f of sample) {
    try {
      const p = await parseFile(f, CORPUS)
      if ((p.errors?.length ?? 0) > 0) {
        errors++
        files.push(f.replace(CORPUS + "/", ""))
      }
    } catch {}
  }
  return { errors, files }
}

async function main() {
  if (!existsSync(NEW)) throw new Error("npm wasm missing")
  const pinnedBackup = readFileSync(PINNED)
  const newWasm = readFileSync(NEW)

  // Baseline with the pinned grammar
  const baseline = await scan()
  console.log(`pinned: ${baseline.files.length}/${sample.length} errors`)

  // Swap in the npm grammar
  writeFileSync(PINNED, newWasm)
  const withNew = await scan()
  console.log(`npm:    ${withNew.files.length}/${sample.length} errors`)

  // Restore the pinned grammar
  writeFileSync(PINNED, pinnedBackup)

  const fixed = baseline.files.filter((f) => !withNew.files.includes(f))
  const regressed = withNew.files.filter((f) => !baseline.files.includes(f))
  console.log(`fixed by npm: ${fixed.length}  regressed: ${regressed.length}  both error: ${baseline.files.filter((f) => withNew.files.includes(f)).length}`)
  for (const f of fixed.slice(0, 15)) console.log(`  FIXED ${f}`)
  for (const f of regressed.slice(0, 15)) console.log(`  REGRESS ${f}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
