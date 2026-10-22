#!/usr/bin/env bun
/**
 * THE WASM PARSE-LIFETIME PROBE, OVER REAL FILES (Lead, 2026-10-21).
 *
 * ★ WHY THIS EXISTS. The dart lane found a measurement defect that could have poisoned the whole
 * fleet: a tree-sitter WASM module's memory grows with every parse and never shrinks; at roughly
 * 7,600 parses the module ABORTS, every later `new Parser` aborts with it, and a single-process walk
 * then PRINTS A WHOLE-POPULATION HEADER OVER A FRACTION OF THE POPULATION. Its own first two censuses
 * were exactly that defect, and its fix was to CHUNK the walk — one process per 2,000 files, merged.
 *
 * ★ BUT THE FIRST VERSION OF THIS PROBE MEASURED THE WRONG THING, AND IT IS WORTH RECORDING WHY. It
 * parsed ONE SMALL SOURCE 12,000 times and reported no abort, with flat memory. The dart lane's
 * census parses REAL FILES, and a real file is a big tree: the WASM allocations that accumulate are
 * proportional to the TREE, not to the parse count. A probe that parses a 60-byte source forever
 * measures a case the fleet never runs.
 *
 * SO THIS PROBE PARSES REAL FILES FROM THE REAL CORPUS, AND IT MEASURES THE SHAPE THAT MATTERS:
 * how many REAL FILES the shared path can parse before the module aborts, and what the RSS curve
 * looks like on the way there.
 *
 * ★ AND IT ANSWERS THE QUESTION THAT DECIDES WHETHER THE FLEET MUST CHUNK: THE SHARED PATH IS
 * `src/ast/engine.ts`'s `getParser`, reached by `script/m14/incoming-gate.ts` through `parseFile`. If
 * the shared path survives a whole population, no lane needs to change. If it aborts, EVERY lane's
 * whole-population arm is at risk and the chunking must become fleet-wide.
 *
 * ★ THE CONTROL IS THE POINT. The same walk is run twice — once with `tree.delete()` after each
 * parse, once WITHOUT — because "the tree is never freed" is the most likely cause of a
 * tree-sitter WASM module's monotonic growth, and a probe that does not test the fix cannot report
 * the fix.
 *
 * RUN: bun script/m14/wasm-parse-lifetime.ts [--lang=<language>] [--max=<n>] [--repo=<name>]
 *
 * EXIT: 0 if the shared path parsed every file it attempted; 5 if it aborted — a MEASURED DEFECT in
 * the shared path, which the fleet has to know about before it publishes a whole-population number.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const CORPUS = resolve(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const LANG = argOf("lang", "dart")
const MAX = Number(argOf("max", "8000"))
const REPO = argOf("repo", "")

const rssMb = (): number => {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))
    return m ? Number(m[1]) / 1024 : -1
  } catch {
    return -1
  }
}

/** THE REAL FILES, IN ORDER, FROM THE REAL CORPUS. */
function corpusFiles(): string[] {
  const out: string[] = []
  const roots = REPO ? [join(CORPUS, REPO)] : readdirSync(CORPUS).map((d) => join(CORPUS, d))
  for (const root of roots) {
    const stack = [root]
    while (stack.length > 0 && out.length < MAX * 2) {
      const dir = stack.pop()!
      let entries: string[] = []
      try { entries = readdirSync(dir) } catch { continue }
      for (const e of entries) {
        const p = join(dir, e)
        let st
        try { st = statSync(p) } catch { continue }
        if (st.isDirectory()) { stack.push(p); continue }
        if (!st.isFile()) continue
        if (st.size > 1024 * 1024) continue
        if (p.endsWith(".dart") || p.endsWith(".py") || p.endsWith(".js") || p.endsWith(".ts") ||
            p.endsWith(".rs") || p.endsWith(".go") || p.endsWith(".java") || p.endsWith(".rb")) {
          out.push(p)
        }
        if (out.length >= MAX * 2) break
      }
    }
  }
  return out
}

const files = corpusFiles()
console.log(`WASM PARSE-LIFETIME PROBE — language ${LANG}, over REAL files, ceiling ${MAX}`)
console.log(`corpus: ${CORPUS}${REPO ? `/${REPO}` : ""} · ${files.length} candidate files`)
console.log()

const { getParser } = await import(resolve(ROOT, "src/ast/engine"))

async function run(label: string, deleteTrees: boolean): Promise<{ parsed: number; failed: number; rssEnd: number }> {
  const parser = await getParser(LANG as any)
  const rss0 = rssMb()
  let parsed = 0
  let failed = 0
  const step = Math.max(1, Math.floor(MAX / 12))
  for (let i = 0; i < Math.min(MAX, files.length); i++) {
    let src: string
    try { src = readFileSync(files[i]!, "utf8") } catch { continue }
    try {
      const tree = parser.parse(src)
      void tree.rootNode.childCount
      if (deleteTrees) tree.delete()
      parsed++
    } catch (e) {
      failed++
      console.log(`  ★ FIRST FAILURE at file ${i + 1} (${parsed} parsed): ${String(e).slice(0, 110)}`)
      break
    }
    if (i % step === 0) {
      console.log(`  ${label}  files ${String(i + 1).padStart(6)}  rss ${rssMb().toFixed(1).padStart(7)} MB`)
    }
  }
  const rssEnd = rssMb()
  console.log(`  ${label}  → parsed ${parsed} · failed ${failed} · rss ${rss0.toFixed(1)} → ${rssEnd.toFixed(1)} MB`)
  console.log()
  return { parsed, failed, rssEnd }
}

console.log("PASS 1 — WITH `tree.delete()` after each parse (the fix, if the growth is the trees):")
const withDelete = await run("del", true)
console.log("PASS 2 — WITHOUT `tree.delete()` (the control: the same walk, the trees left to the collector):")
const withoutDelete = await run("nod", false)

console.log("THE VERDICT")
if (withDelete.failed === 0 && withoutDelete.failed === 0) {
  console.log(`  Both passes survived every file they attempted (${withDelete.parsed} and ${withoutDelete.parsed}).`)
  console.log(`  RSS: ${withDelete.rssEnd.toFixed(1)} MB with delete, ${withoutDelete.rssEnd.toFixed(1)} MB without.`)
  console.log("  ⇒ The shared path did NOT abort on this population and this language.")
  console.log("  ⇒ A whole-population walk on the shared path is SAFE HERE, and no lane needs to chunk")
  console.log("    for this reason. (Chunking is still correct for the OTHER reason: a process's memory")
  console.log("    ceiling, and a chunked walk's rows are exact because the chunks are disjoint.)")
  process.exit(0)
}
if (withDelete.failed === 0 && withoutDelete.failed > 0) {
  console.log("  ★ THE ABORT IS THE TREES, NOT THE PARSE COUNT. `tree.delete()` is the fix, and the shared")
  console.log("    path must free each tree or a long walk will silently measure a fraction of the population.")
  process.exit(5)
}
console.log("  ★ THE SHARED PATH ABORTED EVEN WITH `tree.delete()`. The ceiling is a property of the module")
console.log("    and the tree size, so EVERY lane's whole-population arm on this language must be CHUNKED,")
console.log("    exactly as dart's is.")
process.exit(5)
