#!/usr/bin/env bun
/**
 * script/m14/kotlin-renders-emission-census.ts — THE ANALYZER'S `renders` COLUMN OVER THE WHOLE
 * ADMITTED POPULATION, because a corpus-unexercised claim is a claim about a POPULATION and needs
 * its own measurement (the csharp lane's emission census is the model).
 *
 * WHY THIS EXISTS SEPARATELY FROM kotlin-extended-types-census.ts. That instrument measures the
 * CONSTRUCT (annotation sites, delegation sites, ...) in the tree. THIS one measures the ANALYZER'S
 * OUTPUT: how many `renders` relationships the production path publishes over every admitted file.
 * The declaration carries both halves — 0 construct sites (so the emitter cannot fire) AND 0
 * emitted rows (measured, not inferred from the first half).
 *
 * THE PATH IS THE PRODUCTION PATH. `parseFile` from src/ast/engine.ts — not `parse` + `analyze()` —
 * because `analyze()` is not what the product runs (the fleet's own measured lesson: "THE
 * PRODUCTION PATH IS parseFile, NOT parse + analyze"). The parser is re-fetched per file because
 * `parseFile` itself calls `getParser`, whose recycle deletes the parser object every 500 parses;
 * a cached reference then throws on every later file (the kotlin lane's own --prod instrument
 * defect, recorded in .tmp-covb/census.mts).
 *
 * POPULATION. The fleet's admission rule: every top-level `.corpus` entry that is a git work tree,
 * its `git ls-files` trackage, extensions `.kt`/`.kts`, the 1 MiB cap; tracked-but-absent and
 * over-cap files are COUNTED, never silently dropped. `--cap=0` (default) is the whole population;
 * `--cap=<N>` is a stride sample; `--offset=N --cap=<N>` is a disjoint slice (presence is the mode).
 *
 * EXIT NON-ZERO when parsed !== the window's file count: a count of failures is not enough if the
 * exit code stays 0. No tree is retained per file (parseFile owns its own parse); the tree counter
 * is not kept because there is no tree here — the tenth form (tree.delete) applies to walkers.
 *
 * OUTPUT (with --json): validation/m14/measurements/kotlin-renders-emission-census.json
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/kotlin-renders-emission-census.ts --cap=0 --json
 *
 * EXIT: 0 measured · 2 environment (no corpus) · 3 population mismatch
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024
const EXTS = ["kt", "kts"]
const OUT_JSON = path.join(ROOT, "validation/m14/measurements/kotlin-renders-emission-census.json")

const CAP = (() => {
  const hit = process.argv.find((a) => a.startsWith("--cap="))
  return hit ? Number(hit.slice(6)) : 0
})()
const OFFSET = (() => {
  const hit = process.argv.find((a) => a.startsWith("--offset="))
  return hit ? Number(hit.slice("--offset=".length)) : 0
})()
const JSON_OUT = process.argv.includes("--json")

interface Discovery {
  files: string[]
  admitted: number
  tracked: number
  repos: number
  absent: number
  overCap: number
  window: [number, number]
  wholePopulation: boolean
}

function discover(): Discovery {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let tracked = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], admitted: 0, tracked: 0, repos: 0, absent: 0, overCap: 0, window: [0, 0], wholePopulation: false }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let list: string[]
    try {
      list = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of list) {
      const dot = rel.lastIndexOf(".")
      if (dot < 0) continue
      const ext = rel.slice(dot + 1).toLowerCase()
      if (EXTS.indexOf(ext) < 0) continue
      tracked++
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) {
          overCap++
          continue
        }
      } catch {
        absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const admitted = found.length
  const hasOffset = process.argv.some((a) => a.startsWith("--offset="))
  let files = found
  let window: [number, number] = [0, admitted]
  if (hasOffset) {
    const start = Math.min(OFFSET, admitted)
    const end = Math.min(start + (CAP > 0 ? CAP : admitted), admitted)
    files = found.slice(start, end)
    window = [start, end]
  } else if (CAP > 0 && admitted > CAP) {
    const stride = Math.max(1, Math.floor(admitted / CAP))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < CAP; i += stride) picked.push(found[i])
    files = picked
    window = [-1, files.length]
  }
  return { files, admitted, tracked, repos: repos.size, absent, overCap, window, wholePopulation: files.length === admitted }
}

async function main(): Promise<void> {
  const d = discover()
  if (d.files.length === 0) {
    console.error(`kotlin-renders-emission-census: 0 admitted .kt/.kts files under ${CR}.`)
    process.exit(2)
  }
  const engineMod: any = await import(`${ROOT}/src/ast/engine.ts`)
  const parserDummy: any = await engineMod.getParser("kotlin" as any)
  const lang: any = parserDummy.language ?? null
  // The served grammar's identity, from the resolver (§6: the digest of the bytes the resolver serves).
  const { resolveWasmAsset } = await import(`${ROOT}/src/util/wasm.ts`)
  const wasmPath = resolveWasmAsset("tree-sitter-kotlin.wasm")
  const sha256 = createHash("sha256").update(readFileSync(wasmPath)).digest("hex")

  let parsed = 0
  let failed = 0
  const filesFailed: string[] = []
  const rendersRows: any[] = []
  const filesWithRenders = new Set<string>()
  let rendersTotal = 0
  const t0 = Date.now()

  for (const abs of d.files) {
    const rel = path.relative(CR, abs)
    let content: string
    try {
      content = readFileSync(abs, "utf8")
    } catch {
      failed++
      filesFailed.push(`${rel}: read`)
      continue
    }
    let res: any
    try {
      res = await engineMod.parseFile(abs, content)
    } catch (e) {
      failed++
      if (filesFailed.length < 10) filesFailed.push(`${rel}: ${String(e).slice(0, 100)}`)
      continue
    }
    parsed++
    for (const r of res?.relationships ?? []) {
      if (r?.type !== "renders") continue
      rendersTotal++
      filesWithRenders.add(rel)
      if (rendersRows.length < 200) {
        rendersRows.push({
          file: rel,
          source: r.source,
          target: r.target,
          confidence: r.confidence,
          line: r.line_number,
          metadata: r.metadata ?? null,
        })
      }
    }
    if (parsed % 300 === 0) console.error(`  … ${parsed}/${d.files.length} files, ${Math.round((Date.now() - t0) / 1000)}s`)
  }

  if (parsed !== d.files.length) {
    console.error(`POPULATION MISMATCH: parsed ${parsed} != window ${d.files.length} (failed ${failed})`)
    process.exit(3)
  }

  const payload = {
    generated: new Date().toISOString(),
    instrument: "script/m14/kotlin-renders-emission-census.ts",
    rule: "the analyzer's OWN output — `parseFile` from src/ast/engine.ts (the production entry) over the fleet's admitted population; parsed must equal the window's file count or the run exits 3; the declared claim is `renders` = 0 over the WHOLE population",
    language: "kotlin",
    grammar: {
      servedWasm: wasmPath,
      servedDigest: sha256,
      // The served language object is kept only for its identity; the parse is parseFile's own.
      servedLanguageWhoseBytesParse: lang ? "loaded through getParser" : "unknown",
    },
    population: {
      admitted: d.admitted,
      tracked: d.tracked,
      repos: d.repos,
      absentFromDisk: d.absent,
      overCap: d.overCap,
      window: d.window,
      windowFiles: d.files.length,
      parsed,
      failed,
      wholePopulation: d.wholePopulation,
      populationString: `parsed=${parsed}/${d.files.length} admitted=${d.admitted} exts=kt,kts index=no`,
    },
    renders: {
      total: rendersTotal,
      files: filesWithRenders.size,
      rows: rendersRows,
    },
    filesFailed,
  }
  if (JSON_OUT) {
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + "\n")
    console.log(`wrote ${path.relative(ROOT, OUT_JSON)}`)
  }
  console.log(`kotlin-renders-emission-census: parsed=${parsed}/${d.files.length} admitted=${d.admitted} exts=kt,kts index=no`)
  console.log(`  renders edges total=${rendersTotal} in ${filesWithRenders.size} files`)
  if (rendersTotal > 0) {
    for (const r of rendersRows.slice(0, 10)) console.log(`    ${r.file}: ${r.source} -> ${r.target} (${r.metadata?.relationshipType ?? "?"})`)
  }
  console.log(`  ${d.wholePopulation ? "WHOLE POPULATION" : "SAMPLE — the stride is not the population"}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
