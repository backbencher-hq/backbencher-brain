/**
 * The `uses` resolution rate, split by WHICH CONSTRUCT produced the edge.
 *
 * The aggregate is 439/799 (54.9%) on the current corpus and an aggregate alone says
 * nothing about whether that is a defect: the three constructs that carry `uses` have
 * three different reasons an endpoint may be absent, and only one of them is a fault.
 *
 *   `@include` / a `@function` call  the callee must be a mixin or function THIS FILE
 *                                 declares, so an unresolved one is an `@include` of a
 *                                 partial — silence by design (SCSS-L7).
 *   `@extend`                     the target selector may be declared in another file,
 *                                 which is the ordinary case for a BEM codebase: no
 *                                 unresolved edge is fixable without cross-file
 *                                 resolution, and inventing the endpoint is the
 *                                 phantom M60 R7 forbids.
 *
 * So this prints the split so the number can be read as a fact about a construct rather
 * than as a lane-level percentage.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "scss") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => `${a.repo}/${a.rel}`.localeCompare(`${b.repo}/${b.rel}`))

const markerOf = (m: Record<string, any> | undefined): string => {
  if (!m) return "(none)"
  if (m.isScssInclude) return "@include"
  if (m.isScssFunctionCall) return "@function call"
  if (m.isScssExtend) return m.scssExtendShape === "recovered" ? "@extend (recovered shape)" : "@extend"
  if (m.isMixinRef) return "css @mixin/animation ref"
  if (m.isCssKeyframesRef) return "css keyframes ref"
  if (m.cssSpecific) return "css delegated (other)"
  return "(none)"
}
const rows = new Map<string, { n: number; both: number; files: Set<string> }>()
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const names = new Set<string>()
    for (const s of (r.symbols ?? []) as any[]) names.add(String(s?.name ?? ""))
    for (const x of (r.relationships ?? []) as any[]) {
      const t = String(x.type ?? "")
      if (t !== "uses" && t !== "references" && t !== "exports" && t !== "overrides") continue
      const key = `${t} / ${markerOf(x.metadata)}`
      const row = rows.get(key) ?? { n: 0, both: 0, files: new Set<string>() }
      row.n++
      const s = String(x.source ?? ""), tt = String(x.target ?? "")
      if (names.has(s) && names.has(tt)) row.both++
      row.files.add(`${f.repo}/${f.rel}`)
      rows.set(key, row)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
console.log(`files: ${files.length}`)
console.log(`type / construct`.padEnd(48) + `edges`.padStart(8) + `both-resolved`.padStart(16) + `files`.padStart(8))
for (const [k, v] of [...rows].sort((a, b) => b[1].n - a[1].n)) {
  const pct = v.n > 0 ? `${((v.both / v.n) * 100).toFixed(1)}% (${v.both}/${v.n})` : "n/a"
  console.log(`${k.padEnd(48)}${String(v.n).padStart(8)}${pct.padStart(16)}${String(v.files.size).padStart(8)}`)
}
