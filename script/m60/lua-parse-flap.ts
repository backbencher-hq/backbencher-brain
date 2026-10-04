/**
 * M60 LUA-44 probe — is the lua parse failure in the production path a FILE
 * defect or a RACE?
 *
 * The census and the ontology gate both report `[BB-PARSE-ERR] lua | <file> |
 * Incompatible language version 0. Compatibility range 13 through 15.` on a
 * handful of files, and when that happens pool-worker silently degrades to its
 * regex `extractBasicSymbols` fallback — which publishes symbols with NO `kind`
 * (measured: 9 `kind: undefined` symbols corpus-wide, every one of them from a
 * file that reported this error).
 *
 * Two runs of the SAME census on the SAME corpus disagreed about which hledger
 * file lost its edges (27 -> 26 `calls`), so the question is not academic: is a
 * named file unparseable, or is the grammar load racing?
 *
 * Usage: npx tsx script/m60/lua-parse-flap.ts
 */
import { parseFile } from "../../src/ast/pool-worker"
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ROUNDS = Number(process.env.BB_FLAP_ROUNDS ?? "12")
const CONCURRENCY = Number(process.env.BB_FLAP_CONCURRENCY ?? "8")

const targets: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean).sort()
  } catch { continue }
  for (const rel of tracked) if (new RegExp(`${e}/|hledger|wireshark`).test(`${e}/${rel}`)) targets.push(path.join(dir, rel))
}
console.log(`probe: ${targets.length} candidate files x ${ROUNDS} rounds, ${CONCURRENCY} concurrent parseFile calls\n`)

const fails = new Map<string, number>()
const kindless = new Map<string, number>()
let rounds = 0
while (rounds < ROUNDS) {
  let i = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const k = i++
      if (k >= targets.length) return
      const f = targets[k]
      try {
        const r: any = await parseFile(f, path.dirname(f))
        const bad = (r.symbols ?? []).filter((s: any) => !s.kind).length
        if (bad) kindless.set(path.relative(CR, f), bad)
      } catch {
        fails.set(path.relative(CR, f), (fails.get(path.relative(CR, f)) ?? 0) + 1)
      }
    }
  })
  await Promise.all(workers)
  rounds++
}
console.log(`files that produced a THROWN parse error:`)
for (const [f, n] of fails) console.log(`  ${f}: ${n}/${rounds * targets.length} attempts`)
if (!fails.size) console.log("  (none)")
console.log(`\nfiles that produced symbols with NO kind (the regex fallback):`)
for (const [f, n] of kindless) console.log(`  ${f}: kindless symbols seen ${n}x`)
if (!kindless.size) console.log("  (none)")
console.log(`\nfiles probed: ${targets.join("\n  ")}`)