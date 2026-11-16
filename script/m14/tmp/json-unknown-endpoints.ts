/**
 * READ-ONLY PROBE — the 1.97% of endpoints that name NO symbol at all.
 *
 * 64.54% of JSON endpoints are AMBIGUOUS (a property of the language, recorded in
 * §7). This probe is about the other bucket: an endpoint whose text matches no symbol
 * in its file. Those cannot be explained away, so they are the actionable mass — and
 * they are grouped by SHAPE rather than listed, because 40 identical rows teach less
 * than one row with a count and an example.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const REPOS = (process.env.BB_REPOS ?? "terraform,otp,ansible,clj-kondo,svelte,kubernetes").split(",").map((x) => x.trim()).filter(Boolean)

const jobs: { repo: string; dir: string; abs: string; rel: string }[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "json") continue
    jobs.push({ repo, dir, abs, rel })
  }
}

/** What KIND of thing is this endpoint? Classified by shape, not by value. */
const classify = (endpoint: string, edgeType: string): string => {
  if (endpoint.includes("/") && endpoint.includes(".")) return "a URL or file path (looks like a location, not a name)"
  if (endpoint.startsWith("/")) return "an absolute URL path"
  if (endpoint.startsWith("#")) return "a JSON Pointer fragment"
  if (endpoint.includes("@")) return "an npm scoped package (@scope/name)"
  if (endpoint.startsWith(".")) return "a relative path"
  if (edgeType === "contains") return "a contains edge naming a missing key"
  return "a bare name with no matching symbol"
}

let idx = 0
const classes = new Map<string, { n: number; files: Set<string>; ex: string[] }>()
let unknownTotal = 0, unknownEdges = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= jobs.length) return
    const j = jobs[i]
    let r: any
    try { r = await parseFile(j.abs, j.dir) } catch { continue }
    const syms = r.symbols ?? []
    if (syms.length === 0) continue
    const names = new Set(syms.map((s: any) => String(s.name)))
    const quals = new Set(syms.map((s: any) => String(s.qualifiedName ?? "")))
    let fileUnknown = 0
    for (const x of r.relationships ?? []) {
      for (const [side, v] of [["source", String(x.source ?? x.from ?? "")], ["target", String(x.target ?? x.to ?? "")]] as [string, string][]) {
        if (v === "" || names.has(v) || quals.has(v)) continue
        unknownEdges++
        fileUnknown++
        const k = classify(v, String(x.type ?? "").toLowerCase())
        const g = classes.get(k) ?? { n: 0, files: new Set<string>(), ex: [] }
        g.n++
        if (g.files.size < 3) g.files.add(`${j.repo}/${j.rel}`)
        if (g.ex.length < 4) g.ex.push(`${side}=${JSON.stringify(v.slice(0, 70))}  [${x.type}]`)
        classes.set(k, g)
      }
    }
    if (fileUnknown > 0) unknownTotal++
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

console.log(`json endpoints that name no symbol`)
console.log(`  files with at least one: ${unknownTotal}`)
console.log(`  endpoint instances:      ${unknownEdges}\n`)
for (const [k, g] of [...classes.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(g.n).padStart(6)}  ${k}`)
  for (const e of g.ex) console.log(`            ${e}`)
  for (const f of g.files) console.log(`            in ${f}`)
  console.log()
}
