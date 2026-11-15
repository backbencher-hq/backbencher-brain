#!/usr/bin/env npx tsx
/**
 * PROBE — WHICH LANES actually mint a symbol named `this` or `super`? (Fix A's criterion)
 *
 * ## Why this is the measurement Fix A needs before it is safe
 *
 * `keepSymbol`'s `UNIVERSAL` set (`src/ast/pool-worker.ts:545-569`) drops `"this"` and `"super"`
 * for every language, with the comment "Kept unconditionally because no lane produced a
 * legitimate declaration of any of them." F# falsifies that — `core/src/stdlib/
 * WebSharper.StdLib/JavaScript.fs:69-70` is `[<Inline "this">] static member this = X<obj>`.
 *
 * But the set exists BECAUSE some lanes emit such symbols, and the file's own history shows the
 * remedy is per-language (`self`/`Self` were deleted from UNIVERSAL and moved to per-language
 * behaviour for R/Python/Zig). So before removing the two names, the question is exactly:
 *
 *     which languages emit a symbol named `this` or `super`, and how many?
 *
 * Those languages need the name in their per-language `RESERVED` set; the rest can let it
 * through. Dropping the two names without this enumeration would publish keyword noise in the
 * lanes that mint it.
 *
 * ## How it is observed WITHOUT changing the code under test
 *
 * `parseFile` in `src/ast/pool-worker.ts:1099` filters through `keepSymbol`; `engine.parseFile`
 * does NOT filter (`engine.ts:2102` returns `result.symbols` verbatim). So the difference between
 * the two entry points IS the dropped set, and this probe reads the unfiltered one.
 *
 * Population: `--files N` per language, EVEN STRIDE over that language's git-tracked files,
 * sorted. Same draw shape as `probe-dangling-contains-targets.ts` so the two line up.
 *
 * Run: npx tsx validation/m14/fixtures/fsharp/probe-universal-dropped-symbols.ts --files 400
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"

const T0 = Date.now()
const argv = process.argv.slice(2)
const argOf = (f: string, d: string): string => {
  const i = argv.indexOf(f)
  return i >= 0 ? (argv[i + 1] ?? d) : d
}
const PER_LANG = Number(argOf("--files", "400"))
const LANGS = argOf("--langs", "fsharp,php,julia,lua,css,clean,python,ruby").split(",").map((s) => s.trim()).filter(Boolean)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const EXTS: Record<string, string[]> = {
  fsharp: [".fs", ".fsi", ".fsx"], php: [".php"], julia: [".jl"], lua: [".lua"], css: [".css"],
  clean: [".dcl", ".icl"], python: [".py"], ruby: [".rb"],
}
/** The two names under test, plus the rest of UNIVERSAL, so the answer is complete. */
const WATCHED = new Set(["this", "super", "SCSS_FILE_SCOPE", "GlobalScope", "module_declaration", "package_manifest"])

interface Hit { lang: string; name: string; kind: string; owner: string; file: string }

const hits: Hit[] = []
const perLang = new Map<string, { files: number; draw: number; symbols: number; hits: number; failed: number; nameCounts: Map<string, number> }>()

for (const lang of LANGS) {
  const exts = EXTS[lang] ?? [`.${lang}`]
  const found: { repo: string; abs: string }[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!exts.some((e) => rel.endsWith(e))) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
      found.push({ repo: name, abs })
    }
  }
  found.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  const stride = Math.max(1, Math.floor(found.length / PER_LANG))
  const draw: typeof found = []
  for (let i = 0; i < found.length && draw.length < PER_LANG; i += stride) draw.push(found[i])

  const stat = { files: found.length, draw: draw.length, symbols: 0, hits: 0, failed: 0, nameCounts: new Map<string, number>() }
  perLang.set(lang, stat)

  let cursor = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++
      if (i >= draw.length) return
      const f = draw[i]
      let content: string
      try { content = readFileSync(f.abs, "utf8") } catch { stat.failed++; continue }
      let res: any
      try { res = await ASTEngine.parseFile(f.abs, content) } catch { stat.failed++; continue }
      for (const s of res?.symbols ?? []) {
        stat.symbols++
        const n = String(s?.name ?? "")
        if (!WATCHED.has(n)) continue
        stat.hits++
        stat.nameCounts.set(n, (stat.nameCounts.get(n) ?? 0) + 1)
        if (hits.length < 60) hits.push({ lang, name: n, kind: String(s?.kind ?? "?"), owner: String(s?.ownerName ?? "-"), file: path.relative(CR, f.abs) })
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()))
}

console.log("=".repeat(88))
console.log("PROBE — symbols the UNIVERSAL drop-set removes, by language (engine.parseFile, UNFILTERED)")
console.log("=".repeat(88))
console.log(`load average at start: ${os.loadavg().map((n) => n.toFixed(2)).join(" ")}  cores: ${os.cpus().length}`)
console.log(`per-language draw: up to ${PER_LANG} files by even stride; 4 workers each`)
console.log(`watched names: ${[...WATCHED].join(", ")}`)
console.log("")
console.log(`${"language".padEnd(10)} ${"pop".padStart(7)} ${"draw".padStart(6)} ${"symbols".padStart(9)} ${"failed".padStart(7)} ${"DROPPED-NAME HITS".padStart(17)}   names`)
console.log("-".repeat(88))
let totalHits = 0
for (const [lang, s] of perLang) {
  totalHits += s.hits
  const names = [...s.nameCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ") || "-"
  console.log(`${lang.padEnd(10)} ${String(s.files).padStart(7)} ${String(s.draw).padStart(6)} ${String(s.symbols).padStart(9)} ${String(s.failed).padStart(7)} ${String(s.hits).padStart(17)}   ${names}`)
}
console.log("-".repeat(88))
console.log(`TOTAL HITS: ${totalHits}`)
console.log("")
console.log("examples (the lanes that would PUBLISH keyword noise if UNIVERSAL lost these names):")
for (const h of hits.slice(0, 25)) console.log(`  ${h.lang.padEnd(9)} ${h.name.padEnd(12)} kind=${h.kind.padEnd(10)} owner=${h.owner.padEnd(20)} ${h.file}`)
if (!hits.length) console.log("  (none — the two names are inert outside every language measured here)")
console.log("")
console.log(`wall time ${Date.now() - T0}ms`)
process.exit(0)
