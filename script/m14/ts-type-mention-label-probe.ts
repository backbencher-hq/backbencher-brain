/**
 * DERIV_TS — where does a type mention get its LABEL?
 *
 * The 200-file oracle audit put 2,124 `uses` MISSING rows and 1,033 `references`
 * MISSING rows on ONE surface: a name written in a type position. Before either
 * side can be called right, one fact has to be measured, because it decides
 * whether the disagreement is a bug or an unwritten contract:
 *
 *   does the analyzer publish the SAME (source, target) under BOTH labels?
 *
 * The lane's own rulings already answer the general shape — TSD18 and TSD28
 * (fixtures typescript/template-uses-singular) established that one read is
 * SINGULAR, one label, and both were fixes for exactly this: a template read
 * published as `uses` by one pass and `references` by another. The zig lane
 * reached the same verdict on the same shape ("duplicating the declared-type
 * class that already publishes `references (declared-type)` for the same text").
 *
 * So this probe counts:
 *   1. the analyzer's own per-label surface breakdown, from metadata;
 *   2. the (source, target) pairs emitted under BOTH `uses` and `references`;
 *   3. for each label, how many targets bind to a symbol THIS FILE declares —
 *      because a `references` edge to a name no declaration provides asserts a
 *      phantom declaration, which is the error direction the hcl lane named
 *      when it adopted the sql precedent (a global address is `uses`, a project
 *      declaration is `references`).
 *
 * Usage: bun run script/m14/ts-type-mention-label-probe.ts [--files N] [--repo NAME] [--out path.json]
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const FILES = Number(argOf("--files") ?? "200")
const REPO = argOf("--repo") ?? "typescript"
const OUT = argOf("--out")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))

function gitTracked(dir: string): string[] {
  try { return execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { return [] }
}
const repoDir = path.join(CORPUS, REPO)
const rev = (() => { try { return execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })()
const admitted: string[] = []
for (const rel of gitTracked(repoDir).sort()) {
  if (!/\.(ts|tsx|mts|cts)$/.test(rel) || /\.d\.ts$/.test(rel)) continue
  const abs = path.join(repoDir, rel)
  try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
  admitted.push(abs)
  if (FILES > 0 && admitted.length >= FILES) break
}
if (!admitted.length) { console.error(`no admitted .ts files under ${repoDir}`); process.exit(2) }

/** Which analyzer pass produced the row, read off its own metadata. */
const surfaceOf = (r: any): string => {
  const m = r?.metadata ?? {}
  if (m.isTypeReference) return "uses/type"
  if (m.isFieldAccess) return "uses/field"
  if (m.isTemplateInterpolation) return "uses/expr"
  if (m.isJsxComponent) return "instantiates/jsx"
  if (m.relationshipType) return `references/${m.relationshipType}`
  return `${r?.type}/plain`
}

const surfaces = new Map<string, number>()
const both: string[] = []
const unresUses = new Map<string, number>()
const unresRefs = new Map<string, number>()
let idx = 0
let parsed = 0
let totalUses = 0
let totalRefs = 0
let usesResolves = 0
let refsResolves = 0

const worker = async (): Promise<void> => {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const abs = admitted[i]
    let r: any
    try { r = await parseFile(abs, repoDir) } catch { continue }
    parsed++
    const rel = path.relative(repoDir, abs)
    const names = new Set<string>()
    for (const s of r?.symbols ?? []) if (s?.name) names.add(String(s.name))
    const usesKeys = new Set<string>()
    const refsKeys = new Set<string>()
    for (const x of r?.relationships ?? []) {
      const label = String(x?.type ?? "")
      const key = `${x?.source}|${x?.target}`
      const surf = surfaceOf(x)
      surfaces.set(surf, (surfaces.get(surf) ?? 0) + 1)
      if (label === "uses") {
        usesKeys.add(key)
        totalUses++
        if (names.has(String(x?.target))) usesResolves++
        else unresUses.set(String(x?.target), (unresUses.get(String(x?.target)) ?? 0) + 1)
      }
      if (label === "references") {
        refsKeys.add(key)
        totalRefs++
        if (names.has(String(x?.target))) refsResolves++
        else unresRefs.set(String(x?.target), (unresRefs.get(String(x?.target)) ?? 0) + 1)
      }
    }
    for (const k of usesKeys) if (refsKeys.has(k) && both.length < 200) both.push(`${rel} :: ${k}`)
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const top = (m: Map<string, number>, n: number): string => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join(" ")
console.log(`DERIV_TS type-mention label probe — ${REPO}@${rev.slice(0, 10)}`)
console.log(`${admitted.length} files admitted, ${parsed} parsed\n`)
console.log("ANALYZER SURFACES (every relationship, by the metadata the emitting pass wrote)")
for (const [k, v] of [...surfaces.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 30)}${w(v.toLocaleString(), 10)}`)
console.log(`\nTARGET RESOLUTION against the symbols THIS FILE declares`)
console.log(`  uses       ${usesResolves.toLocaleString()}/${totalUses.toLocaleString()}  (${(100 * usesResolves / (totalUses || 1)).toFixed(1)}%)`)
console.log(`  references ${refsResolves.toLocaleString()}/${totalRefs.toLocaleString()}  (${(100 * refsResolves / (totalRefs || 1)).toFixed(1)}%)`)
console.log(`  unresolved uses targets, top:       ${top(unresUses, 15)}`)
console.log(`  unresolved references targets, top: ${top(unresRefs, 15)}`)
console.log(`\n(source,target) pairs published under BOTH uses AND references: ${both.length}${both.length === 200 ? "+" : ""}`)
for (const b of both.slice(0, 15)) console.log(`  ${b}`)
const out: any = { at: new Date().toISOString(), corpus: REPO, revision: rev, files: admitted.length, parsed, surfaces: Object.fromEntries(surfaces), uses: { total: totalUses, resolves: usesResolves, topUnresolved: [...unresUses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60) }, references: { total: totalRefs, resolves: refsResolves, topUnresolved: [...unresRefs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60) }, bothLabels: both }
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }