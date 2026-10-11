#!/usr/bin/env tsx
/**
 * JAVASCRIPT lane — WHY A TARGET DID NOT BIND, decided against the WHOLE corpus.
 *
 * ## The question this file exists to answer
 *
 * `script/m14/javascript-store-resolution.mts` measures what the STORE did with the edges
 * the analyzer emitted, and it can only say whether the indexed SAMPLE publishes a target
 * name. That is a partial index: a cross-file target whose declaration lives outside the
 * sample reads there as "no file in the sample publishes this name", which is true and
 * also the wrong conclusion to draw from it. `script/m14/incoming-gate.ts` has the same
 * shape of blind spot for a different reason — it never runs the store.
 *
 * So this instrument asks the question the other two cannot: over the WHOLE pinned corpus,
 * does any file declare this name? It is the difference between
 *
 *   "the graph failed to bind a target that exists"      (a defect, and fixable)
 *   "nothing in this corpus declares that name"          (not a binding the graph missed)
 *
 * and without that split, every number about unresolved edges — mine included — is a
 * count of unknown provenance.
 *
 * ## How the corpus is scanned
 *
 * Through `parseFile`, the same production entry point the indexer uses, so the names
 * collected here are the names that WOULD be published if every corpus file were indexed.
 * A `FILES = [...]` list is not used: the population is discovered with `git ls-files` from
 * the corpus root at run time and printed with its size, because an instrument that
 * hard-codes its population keeps reporting a confident number after the population moves
 * (`docs/M14-HONESTY-CONTRACT.md`, "an instrument must declare the population").
 *
 * The scan is cached (`--index-out`) so a re-run costs seconds rather than minutes. The
 * cache records the corpus root, the file count and a digest of the file list; a cache that
 * does not match the current population is REFUSED rather than reused, so a stale index
 * cannot silently answer for a different corpus.
 *
 * ## Usage
 *
 *   bun run script/m14/js-ontology/js-detached-triage.mts --store-json=<out of the store instrument>
 *   bun run script/m14/js-ontology/js-detached-triage.mts --store-json=... --index-out=validation/m14/measurements/js-corpus-declarations.json
 *   bun run script/m14/js-ontology/js-detached-triage.mts --store-json=... --index-in=<cached index>
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const STORE_JSON = arg("store-json")
const CORPUS = arg("corpus") ?? "$HOME/fixtures/repositories/svelte"
const INDEX_IN = arg("index-in")
const INDEX_OUT = arg("index-out")

if (!STORE_JSON) {
  console.error("usage: js-detached-triage.mts --store-json=<javascript-store-resolution --json output> [--corpus=<dir>] [--index-in=<cache>] [--index-out=<cache>]")
  process.exit(2)
}

const JS_EXTS = /\.(js|mjs|cjs)$/
const MAX_BYTES = 512 * 1024

/** git-tracked js-family files under the corpus, size-capped, SORTED (a stable population). */
function corpusFiles(): string[] {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", CORPUS, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\0").filter(Boolean)
  } catch {
    console.error(`not a git checkout: ${CORPUS}`)
    process.exit(2)
  }
  const out: string[] = []
  for (const rel of tracked.sort()) {
    if (!JS_EXTS.test(rel)) continue
    const abs = path.join(CORPUS, rel)
    try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
    out.push(abs)
  }
  return out
}

/**
 * The ECMAScript standard library surface, enumerated from the RUNNING ENGINE: every own
 * property of every built-in prototype and constructor, plus every global. Same technique
 * as the store instrument, and for the same reason — the set is executed, not typed.
 */
function ecmaStdlibNames(): Set<string> {
  const names = new Set<string>()
  const addAll = (o: any) => { if (o) for (const n of Object.getOwnPropertyNames(o)) names.add(n) }
  for (const p of [
    Object.prototype, Function.prototype, Array.prototype, String.prototype,
    Number.prototype, Boolean.prototype, Symbol.prototype, BigInt.prototype,
    Date.prototype, RegExp.prototype, Error.prototype, Promise.prototype,
    Map.prototype, Set.prototype, WeakMap.prototype, WeakSet.prototype,
    ArrayBuffer.prototype, DataView.prototype,
  ]) addAll(p)
  const ctorNames = [
    "Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt",
    "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError", "EvalError",
    "ReferenceError", "URIError", "AggregateError", "Promise", "Map", "Set", "WeakMap",
    "WeakSet", "WeakRef", "FinalizationRegistry", "JSON", "Math", "Reflect", "Proxy",
    "ArrayBuffer", "SharedArrayBuffer", "DataView", "Int8Array", "Uint8Array",
    "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
    "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "Iterator",
    "AsyncIterator", "Atomics", "Intl", "WebAssembly",
  ]
  for (const key of ctorNames) {
    const v = (globalThis as any)[key]
    if (!v) continue
    addAll(v)
    if (v.prototype) addAll(v.prototype)
  }
  addAll(globalThis)
  return names
}

type CorpusIndex = {
  corpusRoot: string
  files: number
  fileListDigest: string
  parsed: number
  parseFailures: number
  /** name -> number of corpus files whose analyzer output declares it */
  names: Record<string, number>
  /** qualified member names (`Owner.member`) the corpus publishes, same shape */
  qualified: Record<string, number>
}

function fileListDigest(files: string[]): string {
  const h = createHash("sha256")
  for (const f of files) h.update(path.relative(CORPUS, f)).update("\0")
  return h.digest("hex").slice(0, 16)
}

async function buildIndex(files: string[]): Promise<CorpusIndex> {
  const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
  const names: Record<string, number> = {}
  const qualified: Record<string, number> = {}
  let parsed = 0
  let parseFailures = 0
  const t0 = Date.now()
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const rel = path.relative(CORPUS, f)
    let r: any
    try {
      r = await parseFile(f, rel, undefined as any)
    } catch {
      parseFailures++
      continue
    }
    if (!r?.symbols) { parseFailures++; continue }
    parsed++
    for (const s of r.symbols) {
      const nm = String(s.name ?? "")
      if (nm) names[nm] = (names[nm] ?? 0) + 1
      const qn = String(s.qualifiedName ?? "")
      if (qn && qn !== nm) qualified[qn] = (qualified[qn] ?? 0) + 1
    }
    if (i > 0 && i % 500 === 0) {
      process.stdout.write(`  scanned ${i}/${files.length} files (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`)
    }
  }
  return {
    corpusRoot: CORPUS,
    files: files.length,
    fileListDigest: fileListDigest(files),
    parsed,
    parseFailures,
    names,
    qualified,
  }
}

async function main() {
  const store = JSON.parse(fs.readFileSync(STORE_JSON!, "utf8"))
  const diag = store?.diagnosis
  if (!diag) {
    console.error(`${STORE_JSON} carries no \`diagnosis\` block — regenerate it with the current javascript-store-resolution.mts`)
    process.exit(2)
  }

  const files = corpusFiles()
  if (files.length === 0) { console.error(`no js files under ${CORPUS}`); process.exit(2) }

  let index: CorpusIndex
  if (INDEX_IN && fs.existsSync(INDEX_IN)) {
    const cached: CorpusIndex = JSON.parse(fs.readFileSync(INDEX_IN, "utf8"))
    const digest = fileListDigest(files)
    if (cached.corpusRoot !== CORPUS || cached.fileListDigest !== digest) {
      console.error(
        `refusing the cache: it describes ${cached.files} files at ${cached.corpusRoot} (digest ${cached.fileListDigest}), ` +
        `this population is ${files.length} files at ${CORPUS} (digest ${digest}). A stale index would answer for a different corpus.`,
      )
      process.exit(2)
    }
    index = cached
  } else {
    process.stdout.write(`scanning the whole corpus through parseFile…\n`)
    index = await buildIndex(files)
    if (INDEX_OUT) {
      fs.mkdirSync(path.dirname(INDEX_OUT), { recursive: true })
      fs.writeFileSync(INDEX_OUT, JSON.stringify(index))
      console.log(`corpus declaration index written: ${INDEX_OUT}`)
    }
  }

  const corpusNames = new Set(Object.keys(index.names))
  const qualifiedNames = new Set(Object.keys(index.qualified))
  const std = ecmaStdlibNames()

  console.log(`\nJAVASCRIPT detached-target triage`)
  console.log(`corpus root     : ${CORPUS}`)
  console.log(`corpus js files : ${index.files} (parsed ${index.parsed}, failures ${index.parseFailures})`)
  console.log(`sample measured : ${store.files} files (the store instrument's draw)`)
  console.log(`distinct names  : ${corpusNames.size} declared, ${qualifiedNames.size} container-qualified`)

  const bindable = diag.bindableNames as { name: string; count: number }[]
  const nowhere = diag.nowhereNames as { name: string; count: number }[]
  const bindableRows = diag.detached.bindable as number
  const nowhereRows = diag.detached.nowhere as number

  // ── the split the sample could not make ──
  let rowsCorpusDeclared = 0
  let rowsStdlib = 0
  let rowsNeither = 0
  const namesCorpusDeclared: { name: string; count: number; files: number }[] = []
  const namesNeither: { name: string; count: number }[] = []
  const namesStdlib: { name: string; count: number }[] = []
  for (const { name, count } of nowhere) {
    const inCorpus = corpusNames.has(name)
    // A JS declaration is often not a SYMBOL but a member: `#compiler/builders:x` aside,
    // the analyzer publishes class members as symbols too, so `names` already covers
    // them. `qualified` is kept as a second, stricter spelling of the same fact.
    if (inCorpus) {
      rowsCorpusDeclared += count
      namesCorpusDeclared.push({ name, count, files: index.names[name] })
    } else if (std.has(name)) {
      rowsStdlib += count
      namesStdlib.push({ name, count })
    } else {
      rowsNeither += count
      namesNeither.push({ name, count })
    }
  }

  const pct = (n: number) => (nowhereRows ? `${((100 * n) / nowhereRows).toFixed(1)}%` : "n/a")
  console.log(`\nDETACHED rows, split by what the WHOLE corpus says about the name`)
  console.log(`  total detached (from the store instrument)     : ${bindableRows + nowhereRows}`)
  console.log(`  already sample-declared but unbound (bindable)  : ${bindableRows}`)
  console.log(`  no sample declaration, split further:`)
  console.log(`    CORPUS declares the name (cross-file target)  : ${rowsCorpusDeclared}  ${pct(rowsCorpusDeclared)}`)
  console.log(`    ECMAScript standard-library member name       : ${rowsStdlib}  ${pct(rowsStdlib)}`)
  console.log(`    neither                                       : ${rowsNeither}  ${pct(rowsNeither)}`)

  // Generic in the element type: the corpus-declared rows carry a `files` count the other
  // two lists do not, and a narrower signature erased it at the call site.
  const top = <T extends { name: string; count: number }>(rows: T[], n: number): T[] =>
    [...rows].sort((a, b) => b.count - a.count).slice(0, n)

  console.log(`\n  CORPUS-DECLARED names (the graph had a candidate and did not take it) — top 20:`)
  for (const r of top(namesCorpusDeclared, 20)) console.log(`    ${String(r.count).padStart(6)}  ${r.name.padEnd(28)} ${r.files} file(s)`)
  console.log(`\n  STANDARD-LIBRARY names — top 20:`)
  for (const r of top(namesStdlib, 20)) console.log(`    ${String(r.count).padStart(6)}  ${r.name}`)
  console.log(`\n  NEITHER (no corpus declaration, not a standard-library name) — top 25:`)
  for (const r of top(namesNeither, 25)) console.log(`    ${String(r.count).padStart(6)}  ${r.name}`)

  const out = {
    corpusRoot: CORPUS,
    corpusFiles: index.files,
    sampleFiles: store.files,
    detachedRows: bindableRows + nowhereRows,
    rows: {
      sampleDeclaredButUnbound: bindableRows,
      corpusDeclared: rowsCorpusDeclared,
      standardLibrary: rowsStdlib,
      neither: rowsNeither,
    },
    names: { corpusDeclared: namesCorpusDeclared, standardLibrary: namesStdlib, neither: namesNeither },
  }
  const jsonOut = arg("json")
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2))
    console.log(`\nJSON written: ${jsonOut}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
