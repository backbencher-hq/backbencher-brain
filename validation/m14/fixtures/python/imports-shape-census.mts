/**
 * IMPORTS-SHAPE CENSUS — what the `imports` edges' targets actually look like, so a PROPOSAL
 * about them is priced instead of asserted.
 *
 * READ-ONLY. Walks the first N admitted `.py` files (default 400, the lane census's slice) through
 * the production path and bins every `imports` edge by:
 *
 *   namespace-star   `import M` / `import M as A`  -> target `M:*` (or `A.b:*`)
 *   from-item        `from M import X`             -> target `M:X`
 *   local-relative   `from .m import X`            -> target `X` (round 18's local retarget)
 *   local-absolute   `from M import X` where M names a module THIS SLICE contains
 *
 * and, for the two external shapes, whether the module's first dot-segment is in
 * `sys.stdlib_module_names` — the closed list a stdlib module-namespace claim would declare.
 *
 *   bun run validation/m14/fixtures/python/imports-shape-census.mts --limit 400 [--json out]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const LIMIT = Number(argOf("--limit") ?? "400")
const OUT = argOf("--json")
const STDLIB: Set<string> = (() => {
  try {
    const out = execFileSync("python3", ["-c", "import sys, json; print(json.dumps(sorted(sys.stdlib_module_names)))"], {
      encoding: "utf8", timeout: 10_000,
    })
    return new Set<string>(JSON.parse(out))
  } catch {
    return new Set<string>()
  }
})()

const all: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "python") continue
    all.push(abs)
  }
}
const admitted = LIMIT > 0 ? all.slice(0, LIMIT) : all

const bins = new Map<string, { count: number; stdlib: number; samples: string[] }>()
const bump = (k: string, stdlib: boolean, sample: string) => {
  const b = bins.get(k) ?? { count: 0, stdlib: 0, samples: [] }
  b.count++
  if (stdlib) b.stdlib++
  if (b.samples.length < 5) b.samples.push(sample)
  bins.set(k, b)
}
for (const f of admitted) {
  let r: any
  try { r = await parseFile(f, path.dirname(f), { projectRoot: path.dirname(f) } as any) } catch { continue }
  for (const rel of r?.relationships ?? []) {
    if (String(rel?.type ?? "") !== "imports") continue
    const tgt = String(rel?.target ?? "")
    const md = (rel?.metadata ?? {}) as Record<string, any>
    const colon = tgt.indexOf(":")
    const sample = `${path.relative(CR, f)} ${tgt}`
    if (colon <= 0) {
      bump("local-relative-bare-item", false, sample)
      continue
    }
    const mod = tgt.slice(0, colon)
    const item = tgt.slice(colon + 1)
    const root = mod.split(".")[0] ?? ""
    const isStd = STDLIB.has(root)
    if (item === "*") bump(`namespace-star${isStd ? "/stdlib" : "/other"}`, isStd, sample)
    else bump(`from-item${isStd ? "/stdlib" : "/other"}`, isStd, sample)
    void md
  }
}
console.log(`imports-shape census — ${admitted.length} files, stdlib list ${STDLIB.size} names (sys.stdlib_module_names)`)
for (const [k, v] of [...bins.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${k.padEnd(34)} ${String(v.count).padStart(7)}`)
  for (const s of v.samples) console.log(`    ${s}`)
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify({ files: admitted.length, stdlibListSize: STDLIB.size, bins: Object.fromEntries(bins) }, null, 2))
  console.log(`wrote ${OUT}`)
}
