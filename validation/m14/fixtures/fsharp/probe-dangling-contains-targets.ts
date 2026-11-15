#!/usr/bin/env npx tsx
/**
 * PROBE — containment/publication edges naming an identity the same file did NOT publish.
 * Generalised per language, so a shared-machinery change can be measured BEFORE and AFTER
 * across the fleet rather than only on the lane that found it.
 *
 * ## The invariant
 *
 * For `contains` and `exports`, the target is supposed to be an identity the SAME `parseFile`
 * call minted — the fsharp analyzer's own `contains` pass states it ("the TARGET is always an
 * identity this file minted", `real-fsharp-analyzer.ts:2174-2180`) and `exports` publishes the
 * same spelling. When a target is not among the symbols that call returned, the edge names
 * something the consumer never received.
 *
 * ## Why it is not hypothetical
 *
 * `parseFile` filters symbols through `keepSymbol` (`src/ast/pool-worker.ts:1099`); its
 * `UNIVERSAL` set drops `"this"` and `"super"` unconditionally. The relationships are not
 * filtered at all — and cannot be by that predicate, because the filter is symbol-shaped and a
 * relationship carries endpoint STRINGS. Measured on
 * `fsharp/tests/service/data/SyntaxTree/Type/As 03.fs`: `analyze()` publishes `Module` and
 * `this<Module>`, `parseFile` returns `Module` only, and `contains Module -> Module.this` and
 * `exports Module -> Module.this` both survive.
 *
 * ## Population, stated
 *
 * `--files N` PER LANGUAGE is an EVEN STRIDE over that language's git-tracked files, sorted, so
 * the draw is deterministic and covers repositories in proportion. `--langs` selects the set.
 * The count is a draw; a BEFORE/AFTER comparison over the same draw is the measurement.
 *
 * Run: npx tsx validation/m14/fixtures/fsharp/probe-dangling-contains-targets.ts \
 *        --langs fsharp,php,julia,lua,css --files 600
 */

import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const T0 = Date.now()
const argv = process.argv.slice(2)
const argOf = (f: string, d: string): string => {
  const i = argv.indexOf(f)
  return i >= 0 ? (argv[i + 1] ?? d) : d
}
const PER_LANG = Number(argOf("--files", "600"))
const LANGS = argOf("--langs", "fsharp,php,julia,lua,css").split(",").map((s) => s.trim()).filter(Boolean)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/** repo-relative extension sets, per the corpus. */
const EXTS: Record<string, string[]> = {
  fsharp: [".fs", ".fsi", ".fsx"],
  php: [".php"],
  julia: [".jl"],
  lua: [".lua"],
  css: [".css"],
  clean: [".dcl", ".icl"],
  python: [".py"],
  ruby: [".rb"],
}

interface FileRec { repo: string; abs: string }
const CONTAINMENT = new Set(["contains", "exports"])

interface LangResult {
  lang: string
  population: number
  draw: number
  walked: number
  degraded: number
  containment: number
  dangling: number
  byTarget: Map<string, number>
  examples: string[]
}

async function runLang(lang: string): Promise<LangResult> {
  const exts = EXTS[lang] ?? [`.${lang}`]
  const found: FileRec[] = []
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
  const draw: FileRec[] = []
  for (let i = 0; i < found.length && draw.length < PER_LANG; i += stride) draw.push(found[i])

  const res: LangResult = {
    lang, population: found.length, draw: draw.length, walked: 0, degraded: 0,
    containment: 0, dangling: 0, byTarget: new Map(), examples: [],
  }
  let cursor = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++
      if (i >= draw.length) return
      const f = draw[i]
      let r: any
      try { r = await parseFile(f.abs, f.repo) } catch { continue }
      res.walked++
      if (r?.fallback === true || r?.metadata?.fallback === true) res.degraded++
      const published = new Set<string>()
      for (const s of r.symbols ?? []) {
        if (s?.name) published.add(String(s.name))
        if (s?.qualifiedName) published.add(String(s.qualifiedName))
        if (s?.metadata?.fqn) published.add(String(s.metadata.fqn))
      }
      for (const e of r.relationships ?? []) {
        const t = String(e?.type ?? "")
        if (!CONTAINMENT.has(t)) continue
        res.containment++
        const tgt = String(e?.target ?? "")
        if (!tgt || published.has(tgt)) continue
        res.dangling++
        res.byTarget.set(tgt, (res.byTarget.get(tgt) ?? 0) + 1)
        if (res.examples.length < 6) res.examples.push(`${t} ${e.source} -> ${tgt}  [${path.relative(CR, f.abs)}]`)
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()))
  return res
}

const results: LangResult[] = []
for (const lang of LANGS) results.push(await runLang(lang))

console.log("=".repeat(88))
console.log("PROBE — containment/publication edges naming an identity the same file did NOT publish")
console.log("=".repeat(88))
console.log(`load average at start: ${os.loadavg().map((n) => n.toFixed(2)).join(" ")}  cores: ${os.cpus().length}`)
console.log(`per-language draw: up to ${PER_LANG} files by even stride; 4 workers each`)
console.log("")
console.log(
  `${"language".padEnd(10)} ${"pop".padStart(7)} ${"draw".padStart(6)} ${"walked".padStart(7)} ` +
  `${"degr".padStart(5)} ${"contains+exp".padStart(13)} ${"DANGLING".padStart(9)} ${"rate".padStart(8)}`,
)
console.log("-".repeat(88))
for (const r of results) {
  const rate = r.containment ? (100 * r.dangling / r.containment).toFixed(3) + "%" : "-"
  console.log(
    `${r.lang.padEnd(10)} ${String(r.population).padStart(7)} ${String(r.draw).padStart(6)} ` +
    `${String(r.walked).padStart(7)} ${String(r.degraded).padStart(5)} ` +
    `${String(r.containment).padStart(13)} ${String(r.dangling).padStart(9)} ${rate.padStart(8)}`,
  )
}
console.log("-".repeat(88))
console.log(`TOTAL DANGLING: ${results.reduce((n, r) => n + r.dangling, 0)}`)
console.log("")
for (const r of results) {
  if (!r.dangling) continue
  console.log(`${r.lang}: ${[...r.byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  for (const e of r.examples.slice(0, 3)) console.log(`    ${e}`)
}
console.log("")
console.log(`wall time ${Date.now() - T0}ms`)
process.exit(0)
