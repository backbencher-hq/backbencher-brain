/**
 * WHICH `calls` edges carry no `evidenceClass`, and where do they come from?
 *
 * The whole-corpus census prints `structural:55206 (none):10` for `calls` and
 * `10 0.0%` under `<0.7 conf`. Two standing rules are in tension with that:
 * honesty contract §4 requires a machine-readable reason code on anything under
 * confidence 1.0, and the analyzer's own `addRel` sets `evidenceClass` for every
 * edge it publishes. So either a second code path publishes `calls` without one,
 * or the pool-worker boundary drops it. Both are findings and they are opposite,
 * so this probe names the edges rather than the count.
 *
 * NO REGEX. Instrument: production `parseFile`, then a field read.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const admitted: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}
let idx = 0
let missing = 0
const rows: string[] = []
const confBands = new Map<string, number>()
async function worker() {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    if (!r || r.success === false) continue
    for (const x of r.relationships ?? []) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
      const ec = String((x?.metadata ?? {}).evidenceClass ?? "(none)")
      const c = typeof x?.confidence === "number" ? x.confidence : 1
      const key = `${t} ec=${ec} conf=${c}`
      confBands.set(key, (confBands.get(key) ?? 0) + 1)
      if (ec === "(none)") {
        missing++
        if (rows.length < 25) {
          rows.push(`${f.repo}/${f.rel}:${x?.line_number} ${x?.source} -[${t}]-> ${x?.target} conf=${c} metadata=${JSON.stringify(x?.metadata ?? {})}`)
        }
      }
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))
console.log(`bash evidenceClass census — every edge of every admitted file (${admitted.length} files)`)
console.log(`\nedges with NO evidenceClass: ${missing}`)
for (const r of rows) console.log(`  ${r}`)
console.log(`\n(type, evidenceClass, confidence) -> count`)
for (const k of [...confBands.keys()].sort()) console.log(`  ${k.padEnd(46)} ${confBands.get(k)}`)
