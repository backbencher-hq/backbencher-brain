// The differential's lane scan carries `if (files.length > 4000) return` — an
// early return that stops the WHOLE directory descent once the pool passes
// 4,000 files. On a corpus larger than that the pool is a directory-order
// PREFIX of the corpus, so `--sample 100000` ("full extent") cannot reach the
// rest: the F5 row reports files=4014 as if that were the corpus. This probe
// replicates the scan verbatim and measures what the cap hides, per lane.
import * as fs from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const LANES: Array<{ repo: string; lang: string; ext: string; routeByContent?: string[] }> = [
  { repo: "grails-core", lang: "groovy", ext: "groovy,gradle" },
  { repo: "geb", lang: "groovy", ext: "groovy,gradle" },
]

const extOf = (name: string): string => name.slice(name.lastIndexOf(".") + 1).toLowerCase()

for (const lane of LANES) {
  const repoDir = path.join(CORPUS, lane.repo)
  const files: string[] = []
  let cappedAt = -1
  const scan = (d: string): void => {
    if (files.length > 4000) {
      if (cappedAt === -1) cappedAt = files.length
      return
    }
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) scan(p) }
      else {
        if (!lane.ext.split(",").some((x) => e.name.endsWith("." + x))) continue
        if (lane.routeByContent?.includes(extOf(e.name))) {
          let head = ""
          try { head = fs.readFileSync(p, "utf8").slice(0, 65536) } catch { continue }
          if (detectLanguageFromPath(p, head) !== lane.lang) continue
        }
        files.push(p)
      }
    }
  }
  scan(repoDir)
  const byExt = new Map<string, number>()
  for (const f of files) byExt.set(extOf(f), (byExt.get(extOf(f)) ?? 0) + 1)

  // Uncapped walk, for the comparison the cap demands.
  const all: string[] = []
  const walk = (d: string): void => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) walk(p) }
      else if (lane.ext.split(",").some((x) => e.name.endsWith("." + x))) all.push(p)
    }
  }
  walk(repoDir)
  const allByExt = new Map<string, number>()
  for (const f of all) allByExt.set(extOf(f), (allByExt.get(extOf(f)) ?? 0) + 1)

  console.log(`\n=== ${lane.repo}:${lane.lang} (ext "${lane.ext}")`)
  console.log(`  capped pool      : ${files.length} files  ${[...byExt.entries()].sort().map(([k, v]) => `.${k}=${v}`).join(" ")}`)
  console.log(`  uncapped walk    : ${all.length} files  ${[...allByExt.entries()].sort().map(([k, v]) => `.${k}=${v}`).join(" ")}`)
  console.log(`  cap first fired  : at ${cappedAt === -1 ? "never" : cappedAt + " files"}`)
  console.log(`  HIDDEN by the cap: ${all.length - files.length} files`)
  const inPool = new Set(files)
  const hidden = all.filter((f) => !inPool.has(f))
  const gradleHidden = hidden.filter((f) => f.endsWith(".gradle")).length
  console.log(`  of the hidden    : ${gradleHidden} .gradle, ${hidden.length - gradleHidden} .groovy`)
  console.log(`  first 3 hidden   : ${hidden.slice(0, 3).map((f) => path.relative(repoDir, f)).join(" | ")}`)
}
process.exit(0)
