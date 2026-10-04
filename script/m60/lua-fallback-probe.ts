/**
 * M14 ONTOLOGY CENSUS — lua, phase 4: the FALLBACK question.
 *
 * Why this exists. `pool-worker.parseFile` catches a grammar-load failure and calls
 * `extractFallback`, which returns `{ success: true, errors: [], fallback: true }`
 * — a DEGRADED parse that reports success and zero errors. So a census that tallies
 * `r.relationships` without reading `r.fallback` is mixing two instruments: the
 * tree-sitter analyzer and a text extractor, and cannot say which produced a number.
 *
 * The ABI failure is also FLAKY: the same file parsed in one run and failed in the
 * next with `Incompatible language version 0. Compatibility range 13 through 15.`
 * (pool-worker.ts:1145 logs it). So the answer is measured over several passes and
 * the flakiness itself is reported, because a count that moves between runs on an
 * unchanged corpus is a finding about the instrument.
 *
 * Usage: npx tsx script/m60/lua-fallback-probe.ts [passes]
 */
import { execFileSync } from "node:child_process"
import { statSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const PASSES = Number(process.argv[2] ?? "3")

const files: Array<{ abs: string; dir: string; label: string }> = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
      .sort()
  } catch {
    continue
  }
  for (const rel of tracked) files.push({ abs: path.join(dir, rel), dir, label: `${e}/${rel}` })
}

console.log(`lua-fallback-probe: ${files.length} files, ${PASSES} pass(es)\n`)

for (let pass = 1; pass <= PASSES; pass++) {
  let fb = 0
  let fbSymbols = 0
  let fbEdges = 0
  let fbKinds = 0
  const fbFiles: string[] = []
  let idx = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (true) {
        const i = idx++
        if (i >= files.length) return
        const f = files[i]
        let r: any
        try {
          r = await parseFile(f.abs, f.dir)
        } catch {
          continue
        }
        if (r?.fallback !== true) continue
        fb++
        fbSymbols += r.symbols?.length ?? 0
        const edges = r.relationships?.length ?? 0
        fbEdges += edges
        fbKinds += (r.symbols ?? []).filter((s: any) => String(s?.kind) === "undefined").length
        if (fbFiles.length < 10) fbFiles.push(`${f.label} (${edges} edges)`)
      }
    }),
  )
  console.log(
    `pass ${pass}: fallback files ${fb}/${files.length}  fallback symbols ${fbSymbols}  fallback edges ${fbEdges}  symbols with kind=undefined ${fbKinds}`,
  )
  for (const l of fbFiles) console.log(`    ${l}`)
}
