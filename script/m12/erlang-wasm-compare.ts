// M12.24 Erlang: compare pinned tree-sitter-erlang wasm vs @lumis-sh/wasm-erlang
// 0.26.3 wasm on the corpus (rebar3@0c947d3b) — following the Swift/Go precedent:
// swap the cached wasm in place and scan through the PRODUCTION parseFile path.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = "$HOME/mcp/backbencher-brain"
const CORPUS = "$HOME/fixtures/repositories/rebar3"
const PINNED = `${ROOT}/wasm/tree-sitter-erlang.wasm`
const NEW = "/tmp/ts-erlang-npm/package/tree-sitter-erlang.wasm"

const sample = (() => {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs")
  const { join } = require("node:path") as typeof import("node:path")
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "_build") continue
        walk(p)
      } else if (e.name.endsWith(".erl") && statSync(p).size >= 1024) out.push(p)
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

  const baseline = await scan()
  console.log(`pinned: ${baseline.files.length}/${sample.length} errors`)

  writeFileSync(PINNED, newWasm)
  const withNew = await scan()
  console.log(`lumis:  ${withNew.files.length}/${sample.length} errors`)

  writeFileSync(PINNED, pinnedBackup)

  const fixed = baseline.files.filter((f) => !withNew.files.includes(f))
  const regressed = withNew.files.filter((f) => !baseline.files.includes(f))
  console.log(`fixed by lumis: ${fixed.length}  regressed: ${regressed.length}  both error: ${baseline.files.filter((f) => withNew.files.includes(f)).length}`)
  for (const f of fixed.slice(0, 15)) console.log(`  FIXED ${f}`)
  for (const f of regressed.slice(0, 15)) console.log(`  REGRESS ${f}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
